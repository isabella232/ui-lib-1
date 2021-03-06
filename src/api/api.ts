import HttpStatus from "http-status-codes";
import {
  ApiDispatchers,
  ApiObjectProcessors,
  ApiOptions,
  JsonResult,
  UnprocessedJsonResult,
} from "../types/api";
import { has, isObject, isString, merge, partialRight } from "lodash";
import { v4 } from "uuid";

const SEMICOLON_SEPARATOR = "; ";

const extractIssueMessages = (
  object: UnprocessedJsonResult,
  issueType = "errors",
): string[] => {
  let { errors } = object;
  if (!errors) {
    return [];
  }
  if (isObject(errors) && has(errors, issueType)) {
    errors = errors[issueType];
  }
  if (isString(errors)) {
    return [errors];
  }
  if (Array.isArray(errors)) {
    if (errors.every((error) => isString(error))) {
      return errors;
    }
    return errors.map((error) => error.message);
  }
  return [];
};

export const extractIssueCodes = (
  object: UnprocessedJsonResult,
  issueType = "errors",
): string[] => {
  let { errors } = object;
  if (!errors) {
    return [];
  }
  if (isObject(errors) && has(errors, issueType)) {
    errors = errors[issueType];
  }
  if (isString(errors)) {
    return [];
  }
  if (Array.isArray(errors)) {
    if (errors.every((error) => isString(error))) {
      return [];
    }
    return errors
      .map((error) => error.errorCode)
      .filter((errorCode) => errorCode);
  }
  return [];
};

export const extractErrorMessages = partialRight(
  extractIssueMessages,
  "errors",
);
export const extractWarningMessages = partialRight(
  extractIssueMessages,
  "warnings",
);
export const extractErrorCodes = partialRight(extractIssueCodes, "errors");
export const extractWarningCodes = partialRight(extractIssueCodes, "warnings");

type ApiConnection = {
  apiUrl: string;
  version: string;
};

const defaultOptions = {};

// This specifically checks for 500 server errors. Use this prior to parsing response.
// Some 500 errors don't have JSON body content, and have to be pre-processed here.
// If the server sends 500 with JSON, which will be extracted in `processJsonResponse`
// See T4365 and T5850
const checkForServerError = (response: Response): Promise<Response> =>
  new Promise((resolve, reject) => {
    const { status } = response;
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      const contentType = response.headers.get("Content-Type");
      if (!contentType || !contentType.includes("application/json")) {
        const errorMessage = "500 Server Error";
        return reject(new Error(errorMessage));
      }
    } else if (status === HttpStatus.NOT_FOUND) {
      const errorMessage = "404 Not Found";
      return reject(new Error(errorMessage));
    }
    // Otherwise, fall through to allow `processJsonResponse` to handle json error and warning messages.
    return resolve(response);
  });

// Check for API server version mismatch. If mismatched, throw an error and reload the UI.
const checkForServerVersionMismatch = (response: Response): Promise<Response> =>
  new Promise((resolve) => {
    const { status } = response;
    if (status === HttpStatus.PRECONDITION_FAILED) {
      // If the server rejects the request with PRECONDITION_FAILED, most likely it is due
      // to a version error.
      // Alternatively, it may be some other incompatibility. In any case, the client should
      // reload the UI to correct the issue.
      setTimeout(() => {
        window.location.reload();
      }, 5000);
      throw new Error(`${new Date().toISOString()}
        Server disconnected due to data incompatibility, most likely mismatch in version. Restarting client.`);
    }
    return resolve(response);
  });

export class Api {
  apiName: string;
  apiUrl: string;
  apiVersion: string;
  apiDispatchers: ApiDispatchers | undefined;
  apiObjectProcessors: ApiObjectProcessors | undefined;
  handleError: (
    status: number,
    errorMessage: string,
    object: Record<string, any>,
    options: ApiOptions,
  ) => void;

  constructor(
    apiName: string,
    { apiUrl, version }: ApiConnection,
    handleError?: (
      status: number,
      errorMessage: string,
      object: Record<string, any>,
      options: ApiOptions,
    ) => void,
  ) {
    this.apiName = apiName;
    this.apiUrl = apiUrl;
    this.apiVersion = version;
    this.handleError =
      handleError ||
      ((_, errorMessage, object, options): void =>
        options.handleError && options.handleError(errorMessage, object));
  }

  getAcceptVersionHeader = (): string =>
    `${this.apiName}-version=${this.apiVersion}`;

  getCommonHeaders = (): Record<string, any> => {
    const commonHeaders = {
      accept: `application/json, ${this.getAcceptVersionHeader()}`,
      "x-request-id": v4(),
    };
    return { headers: { ...commonHeaders } };
  };

  getBlob = (urlSuffix: string): Promise<JsonResult<any>> =>
    this.sendBlobRequest("GET", urlSuffix);

  sendBlobRequest = (
    method: string,
    urlSuffix: string,
    body?: Record<string, any>,
    options: ApiOptions = defaultOptions,
  ): Promise<JsonResult<any>> => {
    const headers = merge(
      { headers: { "content-type": "application/json" } },
      this.getCommonHeaders(),
    );
    if (this.apiObjectProcessors) {
      body = this.apiObjectProcessors.processOutbound(body, options);
    }
    const { apiDispatchers } = this;
    const fetchOptions = merge({ method }, apiDispatchers, headers, {
      body: JSON.stringify(body),
    });
    // TODO(lkong): convert the promise chain to awaits.
    apiDispatchers && apiDispatchers.dispatchIsLoading(true);
    return (
      fetch(`${this.apiUrl}${urlSuffix}`, fetchOptions)
        .then(checkForServerError)
        .then(checkForServerVersionMismatch)
        // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
        // @ts-ignore: type JsonResult is not assignable.
        .then((response) => {
          const { status, ok } = response;
          if (ok) {
            let filename = "";
            if (response.headers.has("content-disposition")) {
              const contentDisposition = response.headers.get(
                "content-disposition",
              );
              if (contentDisposition) {
                filename = contentDisposition
                  .split("filename=")[1]
                  .replace(/"/g, "");
              }
            }
            if (!filename) {
              filename = new Date().toISOString();
            }
            return response.blob().then((blob) => ({
              blob,
              filename,
              status,
              statusIsOk: ok,
            }));
          }
          return this.processJsonResponse(
            response,
            merge({}, apiDispatchers, options),
          );
        })
        .catch(this.processCatch.bind(null, urlSuffix, options))
        .then((response) => {
          apiDispatchers && apiDispatchers.dispatchIsLoading(false);
          return response;
        })
    );
  };

  postBlob = (
    urlSuffix: string,
    blob: Blob,
    options: ApiOptions = defaultOptions,
  ): Promise<JsonResult<any>> => {
    const headers = this.getCommonHeaders();
    const formData = new FormData();
    formData.append("file", blob);
    const { apiDispatchers } = this;
    const fetchOptions = merge({ method: "POST" }, apiDispatchers, headers, {
      body: formData,
    });
    // TODO(lkong): convert the promise chain to awaits.
    apiDispatchers && apiDispatchers.dispatchIsSaving(true);
    return fetch(`${this.apiUrl}${urlSuffix}`, fetchOptions)
      .then(checkForServerError)
      .then(checkForServerVersionMismatch)
      .then((resp) =>
        this.processJsonResponse(resp, merge({}, apiDispatchers, options)),
      )
      .catch(this.processCatch.bind(null, urlSuffix, options))
      .then((response) => {
        apiDispatchers && apiDispatchers.dispatchIsSaving(false);
        return response;
      });
  };

  getJson = (
    urlSuffix: string,
    options: ApiOptions = defaultOptions,
  ): Promise<JsonResult<any>> => {
    const { apiDispatchers } = this;
    // TODO(lkong): convert the promise chain to awaits.
    apiDispatchers && apiDispatchers.dispatchIsLoading(true);
    return fetch(`${this.apiUrl}${urlSuffix}`, this.getCommonHeaders())
      .then(checkForServerError)
      .then(checkForServerVersionMismatch)
      .then((resp) =>
        this.processJsonResponse(resp, merge({}, apiDispatchers, options)),
      )
      .catch(this.processCatch.bind(null, urlSuffix, options))
      .then((response) => {
        apiDispatchers && apiDispatchers.dispatchIsLoading(false);
        return response;
      });
  };

  sendJsonUpdateRequest = (
    method: string,
    urlSuffix: string,
    object: Record<string, any>,
    options: ApiOptions = defaultOptions,
  ): Promise<JsonResult<any>> => {
    const headers = merge(
      { headers: { "content-type": "application/json" } },
      this.getCommonHeaders(),
    );
    if (this.apiObjectProcessors) {
      object = this.apiObjectProcessors.processOutbound(object, options);
    }
    const { apiDispatchers } = this;
    const fetchOptions = merge({ method }, headers, {
      body: JSON.stringify(object),
    });
    // TODO(lkong): convert the promise chain to awaits.
    apiDispatchers && apiDispatchers.dispatchIsSaving(true);
    return fetch(`${this.apiUrl}${urlSuffix}`, fetchOptions)
      .then(checkForServerError)
      .then(checkForServerVersionMismatch)
      .then((response) =>
        this.processJsonResponse(response, merge({}, apiDispatchers, options)),
      )
      .catch(this.processCatch.bind(null, urlSuffix, options))
      .then((response) => {
        apiDispatchers && apiDispatchers.dispatchIsSaving(false);
        return response;
      });
  };

  postJson = (
    urlSuffix: string,
    object: Record<string, any>,
    options: ApiOptions = defaultOptions,
  ): Promise<JsonResult<any>> =>
    this.sendJsonUpdateRequest("POST", urlSuffix, object, options);

  putJson = (
    urlSuffix: string,
    object: Record<string, any>,
    options: ApiOptions = defaultOptions,
  ): Promise<JsonResult<any>> =>
    this.sendJsonUpdateRequest("PUT", urlSuffix, object, options);

  patchJson = (
    urlSuffix: string,
    object: Record<string, any>,
    options: ApiOptions = defaultOptions,
  ): Promise<JsonResult<any>> =>
    this.sendJsonUpdateRequest("PATCH", urlSuffix, object, options);

  deleteJson = (
    urlSuffix: string,
    object: Record<string, any>,
    options: ApiOptions = defaultOptions,
  ): Promise<JsonResult<any>> =>
    this.sendJsonUpdateRequest("DELETE", urlSuffix, object, options);

  processJsonResponse = (
    response: Record<string, any>,
    options: ApiOptions = defaultOptions,
  ): JsonResult<any> => {
    const { status, statusText, ok } = response;
    return response.json().then((object) => {
      const hasResultInResponse = options.hasResultInResponse !== false;

      if (this.apiObjectProcessors) {
        object = this.apiObjectProcessors.processInbound(object, options);
      }
      const errorMessages = extractErrorMessages(object);
      const warningMessages = extractWarningMessages(object);
      const errorCodes = extractErrorCodes(object);
      const warningCodes = extractWarningCodes(object);
      let errorMessage = errorMessages.reverse().join(SEMICOLON_SEPARATOR);
      const warningMessage = warningMessages
        .reverse()
        .join(SEMICOLON_SEPARATOR);
      if (!ok && !errorMessage && !warningMessage) {
        errorMessage = statusText;
      }
      if (errorMessage) {
        this.handleError(status, errorMessage, object, options);
      }
      if (warningMessage) {
        options.handleWarning && options.handleWarning(warningMessage, object);
      }

      let result = null;

      if (!hasResultInResponse) {
        result = object;
      } else if (object) {
        result = object.result || object.Result;
      }

      return {
        status,
        statusIsOk: ok,
        result,
        errorMessages,
        errorMessage,
        errorCodes,
        warningMessages,
        warningMessage,
        warningCodes,
      };
    });
  };

  processCatch = (
    urlSuffix: string,
    options: ApiOptions,
    error: Error,
  ): JsonResult<any> => {
    const { apiDispatchers } = this;
    const { handleError } = apiDispatchers || {};
    const { handleError: handleErrorOverride } = options || {};
    let errorMessage = error.message || error.toString();
    errorMessage = `${urlSuffix} error: ${errorMessage}`;
    if (handleErrorOverride) {
      handleErrorOverride(errorMessage, error);
    } else if (handleError) {
      handleError(errorMessage, error);
    }
    return {
      status: 0,
      statusIsOk: false,
      // The result should be undefined (or at-least falsey). See T4487
      result: null,
      errorMessages: [],
      errorMessage,
      errorCodes: [],
      warningMessages: [],
      warningMessage: "",
      warningCodes: [],
    };
  };

  setDispatchers = (apiDispatchers: ApiDispatchers): void => {
    this.apiDispatchers = apiDispatchers;
  };

  setObjectProcessors = (objectProcessors: ApiObjectProcessors): void => {
    this.apiObjectProcessors = objectProcessors;
  };
}
