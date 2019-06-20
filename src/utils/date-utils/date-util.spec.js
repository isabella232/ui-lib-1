// @flow
import moment from "moment-timezone";
import { EPOCH_DATE, EPOCH_DATE_TIME } from "../../constants/date-constants";

import {
  buildDateRangeString,
  extractDateRange,
  extractValidDate,
  formatDate,
  formatDateTime,
} from "./date-util";

moment.tz.setDefault("America/Los_Angeles");

const formattedEpochDate = "1970-01-01";
const formattedDate = "2018-04-20";
const formattedDateAtStartOfDay = "2018-04-20T07:00:00.000Z";
const formattedDateTime = "2018-04-20T18:05:01.000Z";
const longDate = "2018-04-20T18:05:01Z";
const shortDate = "2018-04-20";

// dateToString is the format used by new Date().toString();
const date = new Date("Thu Apr 20 2018 11:05:01 GMT-0700 (PDT)");

describe("date formatting", () => {
  it(`converts a Date object to "${formattedDate}"`, () => {
    expect(formatDate(date)).toEqual(formattedDate);
  });

  it(`converts empty string to "${EPOCH_DATE}"`, () => {
    expect(formatDate("")).toEqual(formattedEpochDate);
  });

  it("converts null to null", () => {
    expect(formatDate(null)).toEqual(null);
  });
});

describe("datetime formatting", () => {
  it(`converts "${longDate}" to "${formattedDateTime}"`, () => {
    expect(formatDateTime(longDate)).toEqual(formattedDateTime);
  });

  it(`converts "${shortDate}" to "${formattedDateAtStartOfDay}"`, () => {
    expect(formatDateTime(shortDate)).toEqual(formattedDateAtStartOfDay);
  });

  it(`converts a Date object to "${formattedDateTime}"`, () => {
    expect(formatDateTime(date)).toEqual(formattedDateTime);
  });

  it(`converts empty string to "${EPOCH_DATE_TIME}"`, () => {
    expect(formatDateTime("")).toEqual(EPOCH_DATE_TIME);
  });

  it("converts null to null", () => {
    expect(formatDateTime(null)).toEqual(null);
  });
});

const DATE_RANGE_OPTIONS = [
  { startDate: "2018-04-20", endDate: "2019-04-20" },
  { startDate: "2018-04-20T16:20:00Z", endDate: "2019-04-20T16:20:00Z" },
];

describe("extractDateRange", () => {
  it("extracts no dates", () => {
    expect(extractDateRange("")).toEqual({ startDate: "" });
  });
  it("extracts end datetime", () => {
    expect(extractDateRange("to 2018-04-20T16:20:00Z")).toEqual({
      endDate: "2018-04-20T16:20:00Z",
    });
  });
  DATE_RANGE_OPTIONS.forEach((dateRangeOption) => {
    const { startDate, endDate } = dateRangeOption;
    it(`extracts startDate ${startDate}`, () => {
      expect(extractDateRange(startDate)).toEqual({ startDate });
    });
    it(`extracts endDate ${endDate}`, () => {
      expect(extractDateRange(`to ${endDate}`)).toEqual({ endDate });
    });
    [" ", "  ", "   "].forEach((spaces) => {
      ["-", "to"].forEach((delimiter) => {
        it(`extracts startDate ${startDate} using delimter: "${spaces}${delimiter}"`, () => {
          expect(extractDateRange(`${startDate}${spaces}${delimiter}`)).toEqual(
            { startDate }
          );
        });
        it(`extracts startDate ${startDate} and endDate ${endDate} using delimter: "${spaces}${delimiter}${spaces}"`, () => {
          expect(
            extractDateRange(
              `${startDate}${spaces}${delimiter}${spaces}${endDate}`
            )
          ).toEqual({
            startDate,
            endDate,
          });
        });
        it(`extracts endDate ${endDate} using delimter: "${delimiter}${spaces}"`, () => {
          expect(
            extractDateRange(`${spaces}${delimiter}${spaces}${endDate}`)
          ).toEqual({ endDate });
        });
      });
    });
  });
});

describe("buildDateRangeString", () => {
  it("builds with no dates", () => {
    expect(buildDateRangeString({})).toEqual("");
  });
  DATE_RANGE_OPTIONS.forEach((dateRangeOption) => {
    const { startDate, endDate } = dateRangeOption;
    it(`builds with startDate ${startDate}`, () => {
      expect(buildDateRangeString({ startDate })).toEqual(startDate);
    });
    it(`builds with endDate ${endDate}`, () => {
      expect(buildDateRangeString({ endDate })).toEqual(`to ${endDate}`);
    });
    it(`builds with startDate ${startDate} endDate ${endDate}`, () => {
      expect(buildDateRangeString({ startDate, endDate })).toEqual(
        `${startDate} to ${endDate}`
      );
    });
  });
});

describe("extractValidDate", () => {
  [null, undefined, "", "abc", "-----"].forEach((invalidDate) => {
    it(`returns null when given ${String(invalidDate)}`, () => {
      expect(extractValidDate(invalidDate)).toEqual(null);
    });
  });
  ["2015-04-20", "1999-04-20"].forEach((validDate) => {
    it(`returns validDate when given ${String(validDate)}`, () => {
      expect(extractValidDate(validDate)).toEqual(validDate);
    });
  });
  ["04/20/2019", "04/20/1999"].forEach((validDate) => {
    it(`returns validDate when given ${String(validDate)}`, () => {
      expect(extractValidDate(validDate, "MM/DD/YYYY")).toEqual(validDate);
    });
  });
  ["20 Apr 2019", "20 Apr 1999"].forEach((validDate) => {
    it(`returns validDate when given ${String(validDate)}`, () => {
      expect(extractValidDate(validDate, "DD MMM YYYY")).toEqual(validDate);
    });
  });
});
