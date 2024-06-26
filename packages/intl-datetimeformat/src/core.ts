import {
  GetOption,
  ResolveLocale,
  invariant,
  defineProperty,
  SupportedLocales,
  PartitionPattern,
  unpackData,
} from '@formatjs/ecma402-abstract';
import getInternalSlots from './get_internal_slots';
import type {getCanonicalLocales} from '@formatjs/intl-getcanonicallocales';
import links from './data/links';
import {
  PackedData,
  UnpackedZoneData,
  DateTimeFormatOptions,
  Formats,
  DateTimeFormatLocaleInternalData,
  RawDateTimeLocaleData,
} from './types';
import {unpack} from './packer';
import {parseDateTimeSkeleton} from './skeleton';
import ToObject from 'es-abstract/2019/ToObject';
import TimeClip from 'es-abstract/2019/TimeClip';
import ToNumber from 'es-abstract/2019/ToNumber';
import WeekDay from 'es-abstract/2019/WeekDay';
import MonthFromTime from 'es-abstract/2019/MonthFromTime';
import DateFromTime from 'es-abstract/2019/DateFromTime';
import HourFromTime from 'es-abstract/2019/HourFromTime';
import MinFromTime from 'es-abstract/2019/MinFromTime';
import SecFromTime from 'es-abstract/2019/SecFromTime';
import YearFromTime from 'es-abstract/2019/YearFromTime';
const UPPERCASED_LINKS = Object.keys(links).reduce(
  (all: Record<string, string>, l) => {
    all[l.toUpperCase()] = links[l as 'Zulu'];
    return all;
  },
  {}
);

export interface IntlDateTimeFormatInternal {
  locale: string;
  dataLocale: string;
  calendar?: string;
  dateStyle?: 'full' | 'long' | 'medium' | 'short';
  timeStyle?: 'full' | 'long' | 'medium' | 'short';
  weekday: 'narrow' | 'short' | 'long';
  era: 'narrow' | 'short' | 'long';
  year: '2-digit' | 'numeric';
  month: '2-digit' | 'numeric' | 'narrow' | 'short' | 'long';
  day: '2-digit' | 'numeric';
  hour: '2-digit' | 'numeric';
  minute: '2-digit' | 'numeric';
  second: '2-digit' | 'numeric';
  timeZoneName: 'short' | 'long';
  hourCycle: string;
  numberingSystem: string;
  timeZone: string;
  pattern: string;
  boundFormat?: Intl.DateTimeFormat['format'];
}

export interface DateTimeFormatPart {
  type:
    | 'literal'
    | 'era'
    | 'year'
    | 'month'
    | 'day'
    | 'hour'
    | 'minute'
    | 'second'
    | 'weekday'
    | 'timeZoneName'
    | 'dayPeriod'
    | 'relatedYear'
    | 'yearName'
    | 'unknown';
  value: 'string';
}

type TABLE_6 =
  | 'weekday'
  | 'era'
  | 'year'
  | 'month'
  | 'day'
  | 'hour'
  | 'minute'
  | 'second'
  | 'timeZoneName';

const DATE_TIME_PROPS: Array<
  keyof Pick<IntlDateTimeFormatInternal, TABLE_6>
> = [
  'weekday',
  'era',
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
  'timeZoneName',
];

const RESOLVED_OPTIONS_KEYS: Array<
  keyof Omit<IntlDateTimeFormatInternal, 'pattern' | 'boundFormat'>
> = [
  'locale',
  'calendar',
  'numberingSystem',
  'dateStyle',
  'timeStyle',
  'timeZone',
  'hourCycle',
  'weekday',
  'era',
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
  'timeZoneName',
];

export interface ResolvedDateTimeFormatOptions {
  locale: string;
  calendar?: string;
  dateStyle?: 'full' | 'long' | 'medium' | 'short';
  timeStyle?: 'full' | 'long' | 'medium' | 'short';
  weekday: 'narrow' | 'short' | 'long';
  era: 'narrow' | 'short' | 'long';
  year: '2-year' | 'numeric';
  month: '2-year' | 'numeric' | 'narrow' | 'short' | 'long';
  day: '2-year' | 'numeric';
  hour: '2-year' | 'numeric';
  minute: '2-year' | 'numeric';
  second: '2-year' | 'numeric';
  timeZoneName: 'short' | 'long';
  hourCycle: string;
  numberingSystem: string;
}

const TYPE_REGEX = /^[a-z0-9]{3,8}$/i;

/**
 * https://tc39.es/ecma402/#sec-isvalidtimezonename
 * @param tz
 */
function isValidTimeZoneName(tz: string): boolean {
  const uppercasedTz = tz.toUpperCase();
  const zoneNames = new Set(
    Object.keys(DateTimeFormat.tzData).map(z => z.toUpperCase())
  );
  return zoneNames.has(uppercasedTz) || uppercasedTz in UPPERCASED_LINKS;
}

/**
 * https://tc39.es/ecma402/#sec-canonicalizetimezonename
 * @param tz
 */
function canonicalizeTimeZoneName(tz: string) {
  const uppercasedTz = tz.toUpperCase();
  const uppercasedZones = Object.keys(DateTimeFormat.tzData).reduce(
    (all: Record<string, string>, z) => {
      all[z.toUpperCase()] = z;
      return all;
    },
    {}
  );

  const ianaTimeZone =
    UPPERCASED_LINKS[uppercasedTz] || uppercasedZones[uppercasedTz];
  if (ianaTimeZone === 'Etc/UTC' || ianaTimeZone === 'Etc/GMT') {
    return 'UTC';
  }
  return ianaTimeZone;
}

interface Opt extends Omit<Formats, 'pattern' | 'pattern12'> {
  localeMatcher: string;
  ca: DateTimeFormatOptions['calendar'];
  nu: DateTimeFormatOptions['numberingSystem'];
  hc: DateTimeFormatOptions['hourCycle'];
}

function isTimeRelated(opt: Opt) {
  for (const prop of ['hour', 'minute', 'second'] as Array<
    keyof Pick<Opt, 'hour' | 'minute' | 'second'>
  >) {
    const value = opt[prop];
    if (value !== undefined) {
      return true;
    }
  }
  return false;
}

/**
 * https://tc39.es/ecma402/#sec-initializedatetimeformat
 * @param dtf DateTimeFormat
 * @param locales locales
 * @param opts options
 */
function initializeDateTimeFormat(
  dtf: DateTimeFormat,
  locales?: string | string[],
  opts?: DateTimeFormatOptions
) {
  // @ts-ignore
  const requestedLocales: string[] = Intl.getCanonicalLocales(locales);
  const options = toDateTimeOptions(opts, 'any', 'date');
  let opt: Opt = Object.create(null);
  let matcher = GetOption(
    options,
    'localeMatcher',
    'string',
    ['lookup', 'best fit'],
    'best fit'
  );
  opt.localeMatcher = matcher;
  let calendar = GetOption(options, 'calendar', 'string', undefined, undefined);
  if (calendar !== undefined && !TYPE_REGEX.test(calendar)) {
    throw new RangeError('Malformed calendar');
  }
  const internalSlots = getInternalSlots(dtf);
  opt.ca = calendar;
  const numberingSystem = GetOption(
    options,
    'numberingSystem',
    'string',
    undefined,
    undefined
  );
  if (numberingSystem !== undefined && !TYPE_REGEX.test(numberingSystem)) {
    throw new RangeError('Malformed numbering system');
  }
  opt.nu = numberingSystem;
  const hour12 = GetOption(options, 'hour12', 'boolean', undefined, undefined);
  let hourCycle = GetOption(
    options,
    'hourCycle',
    'string',
    ['h11', 'h12', 'h23', 'h24'],
    undefined
  );
  if (hour12 !== undefined) {
    // @ts-ignore
    hourCycle = null;
  }
  opt.hc = hourCycle;
  const r = ResolveLocale(
    DateTimeFormat.availableLocales,
    requestedLocales,
    // TODO: Fix the type
    opt as any,
    // [[RelevantExtensionKeys]] slot, which is a constant
    ['nu', 'ca', 'hc'],
    DateTimeFormat.localeData,
    DateTimeFormat.getDefaultLocale
  );
  internalSlots.locale = r.locale;
  calendar = r.ca;
  internalSlots.calendar = calendar;
  internalSlots.hourCycle = r.hc;
  internalSlots.numberingSystem = r.nu;
  const {dataLocale} = r;
  internalSlots.dataLocale = dataLocale;
  let {timeZone} = options;
  if (timeZone !== undefined) {
    timeZone = String(timeZone);
    if (!isValidTimeZoneName(timeZone)) {
      throw new RangeError('Invalid timeZoneName');
    }
    timeZone = canonicalizeTimeZoneName(timeZone);
  } else {
    timeZone = DateTimeFormat.getDefaultTimeZone();
  }
  internalSlots.timeZone = timeZone;

  opt = Object.create(null);
  opt.weekday = GetOption(
    options,
    'weekday',
    'string',
    ['narrow', 'short', 'long'],
    undefined
  );
  opt.era = GetOption(
    options,
    'era',
    'string',
    ['narrow', 'short', 'long'],
    undefined
  );
  opt.year = GetOption(
    options,
    'year',
    'string',
    ['2-digit', 'numeric'],
    undefined
  );
  opt.month = GetOption(
    options,
    'month',
    'string',
    ['2-digit', 'numeric', 'narrow', 'short', 'long'],
    undefined
  );
  opt.day = GetOption(
    options,
    'day',
    'string',
    ['2-digit', 'numeric'],
    undefined
  );
  opt.hour = GetOption(
    options,
    'hour',
    'string',
    ['2-digit', 'numeric'],
    undefined
  );
  opt.minute = GetOption(
    options,
    'minute',
    'string',
    ['2-digit', 'numeric'],
    undefined
  );
  opt.second = GetOption(
    options,
    'second',
    'string',
    ['2-digit', 'numeric'],
    undefined
  );
  opt.timeZoneName = GetOption(
    options,
    'timeZoneName',
    'string',
    ['short', 'long'],
    undefined
  );

  const dataLocaleData = DateTimeFormat.localeData[dataLocale];
  const formats = dataLocaleData.formats[calendar as string];
  matcher = GetOption(
    options,
    'formatMatcher',
    'string',
    ['basic', 'best fit'],
    'best fit'
  );
  const dateStyle = GetOption(
    options,
    'dateStyle',
    'string',
    ['full', 'long', 'medium', 'short'],
    undefined
  );
  internalSlots.dateStyle = dateStyle;
  const timeStyle = GetOption(
    options,
    'timeStyle',
    'string',
    ['full', 'long', 'medium', 'short'],
    undefined
  );
  internalSlots.timeStyle = timeStyle;

  let bestFormat;
  if (dateStyle === undefined && timeStyle === undefined) {
    if (matcher === 'basic') {
      bestFormat = basicFormatMatcher(opt, formats);
    } else {
      if (isTimeRelated(opt)) {
        opt.hour12 =
          internalSlots.hourCycle === 'h11' ||
          internalSlots.hourCycle === 'h12';
      }
      bestFormat = bestFitFormatMatcher(opt, formats);
    }
  } else {
    for (const prop of DATE_TIME_PROPS) {
      const p = opt[prop];
      if (p !== undefined) {
        throw new TypeError(
          `Intl.DateTimeFormat can't set option ${prop} when ${
            dateStyle ? 'dateStyle' : 'timeStyle'
          } is used`
        );
      }
    }
    bestFormat = dateTimeStyleFormat(dateStyle, timeStyle, dataLocaleData);
  }
  for (const prop in opt) {
    const p = bestFormat[prop as 'era'];
    if (p !== undefined) {
      internalSlots[prop as 'year'] = p as 'numeric';
    }
  }
  let pattern;
  if (internalSlots.hour !== undefined) {
    const hcDefault = dataLocaleData.hourCycle;
    let hc = internalSlots.hourCycle;
    if (hc == null) {
      hc = hcDefault;
    }
    if (hour12 !== undefined) {
      if (hour12) {
        if (hcDefault === 'h11' || hcDefault === 'h23') {
          hc = 'h11';
        } else {
          hc = 'h12';
        }
      } else {
        invariant(!hour12, 'hour12 must not be set');
        if (hcDefault === 'h11' || hcDefault === 'h23') {
          hc = 'h23';
        } else {
          hc = 'h24';
        }
      }
    }
    internalSlots.hourCycle = hc;

    if (hc === 'h11' || hc === 'h12') {
      pattern = bestFormat.pattern12;
    } else {
      pattern = bestFormat.pattern;
    }
  } else {
    // @ts-ignore
    internalSlots.hourCycle = undefined;
    pattern = bestFormat.pattern;
  }
  internalSlots.pattern = pattern;
  return dtf;
}

/**
 * https://tc39.es/ecma402/#sec-todatetimeoptions
 * @param options
 * @param required
 * @param defaults
 */
export function toDateTimeOptions(
  options?: DateTimeFormatOptions | null,
  required?: string,
  defaults?: string
): DateTimeFormatOptions {
  if (options === undefined) {
    options = null;
  } else {
    options = ToObject(options);
  }
  options = Object.create(options) as DateTimeFormatOptions;
  let needDefaults = true;
  if (required === 'date' || required === 'any') {
    for (const prop of ['weekday', 'year', 'month', 'day'] as Array<
      keyof Pick<DateTimeFormatOptions, 'weekday' | 'year' | 'month' | 'day'>
    >) {
      const value = options[prop];
      if (value !== undefined) {
        needDefaults = false;
      }
    }
  }
  if (required === 'time' || required === 'any') {
    for (const prop of ['hour', 'minute', 'second'] as Array<
      keyof Pick<DateTimeFormatOptions, 'hour' | 'minute' | 'second'>
    >) {
      const value = options[prop];
      if (value !== undefined) {
        needDefaults = false;
      }
    }
  }
  if (options.dateStyle !== undefined || options.timeStyle !== undefined) {
    needDefaults = false;
  }
  if (required === 'date' && options.timeStyle) {
    throw new TypeError(
      'Intl.DateTimeFormat date was required but timeStyle was included'
    );
  }
  if (required === 'time' && options.dateStyle) {
    throw new TypeError(
      'Intl.DateTimeFormat time was required but dateStyle was included'
    );
  }

  if (needDefaults && (defaults === 'date' || defaults === 'all')) {
    for (const prop of ['year', 'month', 'day'] as Array<
      keyof Pick<DateTimeFormatOptions, 'year' | 'month' | 'day'>
    >) {
      options[prop] = 'numeric';
    }
  }
  if (needDefaults && (defaults === 'time' || defaults === 'all')) {
    for (const prop of ['hour', 'minute', 'second'] as Array<
      keyof Pick<DateTimeFormatOptions, 'hour' | 'minute' | 'second'>
    >) {
      options[prop] = 'numeric';
    }
  }
  return options;
}

const BASIC_FORMAT_MATCHER_VALUES = [
  '2-digit',
  'numeric',
  'narrow',
  'short',
  'long',
];

const removalPenalty = 120;
const additionPenalty = 20;
const differentNumericTypePenalty = 15;
const longLessPenalty = 8;
const longMorePenalty = 6;
const shortLessPenalty = 6;
const shortMorePenalty = 3;

export function basicFormatMatcherScore(
  options: DateTimeFormatOptions,
  format: Formats
): number {
  let score = 0;
  for (const prop of DATE_TIME_PROPS) {
    const optionsProp = options[prop];
    const formatProp = format[prop];
    if (optionsProp === undefined && formatProp !== undefined) {
      score -= additionPenalty;
    } else if (optionsProp !== undefined && formatProp === undefined) {
      score -= removalPenalty;
    } else if (optionsProp !== formatProp) {
      const optionsPropIndex = BASIC_FORMAT_MATCHER_VALUES.indexOf(
        optionsProp as string
      );
      const formatPropIndex = BASIC_FORMAT_MATCHER_VALUES.indexOf(
        formatProp as string
      );
      const delta = Math.max(
        -2,
        Math.min(formatPropIndex - optionsPropIndex, 2)
      );
      if (delta === 2) {
        score -= longMorePenalty;
      } else if (delta === 1) {
        score -= shortMorePenalty;
      } else if (delta === -1) {
        score -= shortLessPenalty;
      } else if (delta === -2) {
        score -= longLessPenalty;
      }
    }
  }
  return score;
}

/**
 * Credit: https://github.com/andyearnshaw/Intl.js/blob/0958dc1ad8153f1056653ea22b8208f0df289a4e/src/12.datetimeformat.js#L611
 * with some modifications
 * @param options
 * @param format
 */
export function bestFitFormatMatcherScore(
  options: DateTimeFormatOptions,
  format: Formats
): number {
  let score = 0;
  if (options.hour12 && !format.hour12) {
    score -= removalPenalty;
  } else if (!options.hour12 && format.hour12) {
    score -= additionPenalty;
  }
  for (const prop of DATE_TIME_PROPS) {
    const optionsProp = options[prop as TABLE_6];
    const formatProp = format[prop as TABLE_6];
    if (optionsProp === undefined && formatProp !== undefined) {
      score -= additionPenalty;
    } else if (optionsProp !== undefined && formatProp === undefined) {
      score -= removalPenalty;
    } else if (optionsProp !== formatProp) {
      // extra penalty for numeric vs non-numeric
      if (
        isNumericType(optionsProp as 'numeric') !==
        isNumericType(formatProp as 'short')
      ) {
        score -= differentNumericTypePenalty;
      } else {
        const optionsPropIndex = BASIC_FORMAT_MATCHER_VALUES.indexOf(
          optionsProp as string
        );
        const formatPropIndex = BASIC_FORMAT_MATCHER_VALUES.indexOf(
          formatProp as string
        );
        const delta = Math.max(
          -2,
          Math.min(formatPropIndex - optionsPropIndex, 2)
        );
        if (delta === 2) {
          score -= longMorePenalty;
        } else if (delta === 1) {
          score -= shortMorePenalty;
        } else if (delta === -1) {
          score -= shortLessPenalty;
        } else if (delta === -2) {
          score -= longLessPenalty;
        }
      }
    }
  }
  return score;
}

function dateTimeStyleFormat(
  dateStyle: DateTimeFormatOptions['dateStyle'],
  timeStyle: DateTimeFormatOptions['timeStyle'],
  dataLocaleData: DateTimeFormatLocaleInternalData
): Formats {
  let dateFormat: Formats | undefined, timeFormat: Formats | undefined;
  if (timeStyle !== undefined) {
    timeFormat = dataLocaleData.timeFormat[timeStyle];
  }
  if (dateStyle !== undefined) {
    dateFormat = dataLocaleData.dateFormat[dateStyle];
  }

  if (
    dateStyle !== undefined &&
    dateFormat !== undefined &&
    timeFormat !== undefined
  ) {
    const format = {...dateFormat, ...timeFormat};
    delete format.pattern;
    delete format.pattern12;

    const connector = dataLocaleData.dateTimeFormat[dateStyle];
    format.pattern = connector
      .replace('{0}', timeFormat.pattern)
      .replace('{1}', dateFormat.pattern);
    if (timeFormat.pattern12 !== undefined) {
      format.pattern12 = connector
        .replace('{0}', timeFormat.pattern12)
        .replace('{1}', dateFormat.pattern);
    }
    return format as Formats;
  }
  if (timeFormat !== undefined) {
    return timeFormat;
  }
  if (dateFormat === undefined) {
    throw new TypeError(
      'Intl.DateTimeFormat neither the dateFormat or the timeFormat could be found'
    );
  }

  return dateFormat;
}

/**
 * https://tc39.es/ecma402/#sec-basicformatmatcher
 * @param options
 * @param formats
 */
function basicFormatMatcher(
  options: DateTimeFormatOptions,
  formats: Formats[]
) {
  let bestScore = -Infinity;
  let bestFormat = formats[0];
  invariant(Array.isArray(formats), 'formats should be a list of things');
  for (const format of formats) {
    const score = basicFormatMatcherScore(options, format);
    if (score > bestScore) {
      bestScore = score;
      bestFormat = format;
    }
  }
  return {...bestFormat};
}

function isNumericType(
  t: 'numeric' | '2-digit' | 'narrow' | 'short' | 'long'
): boolean {
  return t === 'numeric' || t === '2-digit';
}

/**
 * https://tc39.es/ecma402/#sec-bestfitformatmatcher
 * Just alias to basic for now
 * @param options
 * @param formats
 */
function bestFitFormatMatcher(
  options: DateTimeFormatOptions,
  formats: Formats[]
) {
  let bestScore = -Infinity;
  let bestFormat = formats[0];
  invariant(Array.isArray(formats), 'formats should be a list of things');
  for (const format of formats) {
    const score = bestFitFormatMatcherScore(options, format);
    if (score > bestScore) {
      bestScore = score;
      bestFormat = format;
    }
  }

  const skeletonFormat = {...bestFormat};
  const patternFormat = parseDateTimeSkeleton(bestFormat.rawPattern);

  // Kinda following https://github.com/unicode-org/icu/blob/dd50e38f459d84e9bf1b0c618be8483d318458ad/icu4j/main/classes/core/src/com/ibm/icu/text/DateTimePatternGenerator.java
  // Method adjustFieldTypes
  for (const prop in patternFormat) {
    const skeletonValue = skeletonFormat[prop as TABLE_6];
    const patternValue = patternFormat[prop as TABLE_6];
    const requestedValue = options[prop as TABLE_6];
    // Don't mess with minute/second or we can get in the situation of
    // 7:0:0 which is weird
    if (prop === 'minute' || prop === 'second') {
      continue;
    }
    // Nothing to do here
    if (!requestedValue) {
      continue;
    }
    // https://unicode.org/reports/tr35/tr35-dates.html#Matching_Skeletons
    // Looks like we should not convert numeric to alphabetic but the other way
    // around is ok
    if (
      isNumericType(patternValue as 'numeric') &&
      !isNumericType(requestedValue as 'short')
    ) {
      continue;
    }

    if (skeletonValue === requestedValue) {
      continue;
    }
    patternFormat[prop as TABLE_6] = requestedValue;
  }
  return patternFormat;
}

const formatDescriptor = {
  enumerable: false,
  configurable: true,
  get() {
    if (typeof this !== 'object' || !(this instanceof DateTimeFormat)) {
      throw TypeError(
        'Intl.DateTimeFormat format property accessor called on incompatible receiver'
      );
    }
    const internalSlots = getInternalSlots(this);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const dtf = this;
    let boundFormat = internalSlots.boundFormat;
    if (boundFormat === undefined) {
      // https://tc39.es/proposal-unified-intl-numberformat/section11/numberformat_diff_out.html#sec-number-format-functions
      boundFormat = (date?: Date | number) => {
        let x: number;
        if (date === undefined) {
          x = Date.now();
        } else {
          x = Number(date);
        }
        return formatDateTime(dtf, x);
      };
      try {
        // https://github.com/tc39/test262/blob/master/test/intl402/NumberFormat/prototype/format/format-function-name.js
        Object.defineProperty(boundFormat, 'name', {
          configurable: true,
          enumerable: false,
          writable: false,
          value: '',
        });
      } catch (e) {
        // In older browser (e.g Chrome 36 like polyfill.io)
        // TypeError: Cannot redefine property: name
      }
      internalSlots.boundFormat = boundFormat;
    }
    return boundFormat;
  },
} as const;
try {
  // https://github.com/tc39/test262/blob/master/test/intl402/NumberFormat/prototype/format/name.js
  Object.defineProperty(formatDescriptor.get, 'name', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: 'get format',
  });
} catch (e) {
  // In older browser (e.g Chrome 36 like polyfill.io)
  // TypeError: Cannot redefine property: name
}

function pad(n: number): string {
  if (n < 10) {
    return `0${n}`;
  }
  return String(n);
}

function offsetToGmtString(
  gmtFormat: string,
  hourFormat: string,
  offsetInMs: number,
  style: 'long' | 'short'
) {
  const offsetInMinutes = Math.floor(offsetInMs / 60000);
  const mins = Math.abs(offsetInMinutes) % 60;
  const hours = Math.floor(Math.abs(offsetInMinutes) / 60);
  const [positivePattern, negativePattern] = hourFormat.split(';');

  let offsetStr = '';
  let pattern = offsetInMs < 0 ? negativePattern : positivePattern;
  if (style === 'long') {
    offsetStr = pattern
      .replace('HH', pad(hours))
      .replace('H', String(hours))
      .replace('mm', pad(mins))
      .replace('m', String(mins));
  } else if (mins || hours) {
    if (!mins) {
      pattern = pattern.replace(/:?m+/, '');
    }
    offsetStr = pattern
      .replace(/H+/, String(hours))
      .replace(/m+/, String(mins));
  }

  return gmtFormat.replace('{0}', offsetStr);
}

/**
 * https://tc39.es/ecma402/#sec-partitiondatetimepattern
 * @param dtf
 * @param x
 */
function partitionDateTimePattern(dtf: DateTimeFormat, x: number) {
  x = TimeClip(x);
  if (isNaN(x)) {
    throw new RangeError('invalid time');
  }

  /** IMPL START */
  const internalSlots = getInternalSlots(dtf);
  const dataLocale = internalSlots.dataLocale;
  const dataLocaleData = DateTimeFormat.localeData[dataLocale];
  /** IMPL END */

  const locale = internalSlots.locale;
  const nfOptions = Object.create(null);
  nfOptions.useGrouping = false;

  const nf = new Intl.NumberFormat(locale, nfOptions);
  const nf2Options = Object.create(null);
  nf2Options.minimumIntegerDigits = 2;
  nf2Options.useGrouping = false;
  const nf2 = new Intl.NumberFormat(locale, nf2Options);
  const tm = toLocalTime(
    x,
    // @ts-ignore
    internalSlots.calendar,
    internalSlots.timeZone
  );
  const result = [];
  const patternParts = PartitionPattern(internalSlots.pattern);
  for (const patternPart of patternParts) {
    const p = patternPart.type;
    if (p === 'literal') {
      result.push({
        type: 'literal',
        value: patternPart.value,
      });
    } else if (DATE_TIME_PROPS.indexOf(p as 'era') > -1) {
      let fv = '';
      const f = internalSlots[p as 'year'] as
        | 'numeric'
        | '2-digit'
        | 'narrow'
        | 'long'
        | 'short';
      // @ts-ignore
      let v = tm[p];
      if (p === 'year' && v <= 0) {
        v = 1 - v;
      }
      if (p === 'month') {
        v++;
      }
      const hourCycle = internalSlots.hourCycle;
      if (p === 'hour' && (hourCycle === 'h11' || hourCycle === 'h12')) {
        v = v % 12;
        if (v === 0 && hourCycle === 'h12') {
          v = 12;
        }
      }
      if (p === 'hour' && hourCycle === 'h24') {
        if (v === 0) {
          v = 24;
        }
      }
      if (f === 'numeric') {
        fv = nf.format(v);
      } else if (f === '2-digit') {
        fv = nf2.format(v);
        if (fv.length > 2) {
          fv = fv.slice(fv.length - 2, fv.length);
        }
      } else if (f === 'narrow' || f === 'short' || f === 'long') {
        if (p === 'era') {
          fv = dataLocaleData[p][f][v as 'BC'];
        } else if (p === 'timeZoneName') {
          const {timeZoneName, gmtFormat, hourFormat} = dataLocaleData;
          const timeZone =
            internalSlots.timeZone || DateTimeFormat.getDefaultTimeZone();
          const timeZoneData = timeZoneName[timeZone];
          if (timeZoneData && timeZoneData[f as 'short']) {
            fv = timeZoneData[f as 'short']![+tm.inDST];
          } else {
            // Fallback to gmtFormat
            fv = offsetToGmtString(
              gmtFormat,
              hourFormat,
              tm.timeZoneOffset,
              f as 'long'
            );
          }
        } else if (p === 'month') {
          fv = dataLocaleData.month[f][v - 1];
        } else {
          fv = dataLocaleData[p as 'weekday'][f][v];
        }
      }
      result.push({
        type: p,
        value: fv,
      });
    } else if (p === 'ampm') {
      const v = tm.hour;
      let fv;
      if (v >= 11) {
        fv = dataLocaleData.pm;
      } else {
        fv = dataLocaleData.am;
      }
      result.push({
        type: 'dayPeriod',
        value: fv,
      });
    } else if (p === 'relatedYear') {
      const v = tm.relatedYear;
      // @ts-ignore
      const fv = nf.format(v);
      result.push({
        type: 'relatedYear',
        value: fv,
      });
    } else if (p === 'yearName') {
      const v = tm.yearName;
      // @ts-ignore
      const fv = nf.format(v);
      result.push({
        type: 'yearName',
        value: fv,
      });
    } else {
      result.push({
        type: 'unknown',
        value: x,
      });
    }
  }
  return result;
}

/**
 * https://tc39.es/ecma402/#sec-formatdatetime
 * @param dtf DateTimeFormat
 * @param x
 */
function formatDateTime(dtf: DateTimeFormat, x: number) {
  const parts = partitionDateTimePattern(dtf, x);
  let result = '';
  for (const part of parts) {
    result += part.value;
  }
  return result;
}

/**
 * https://tc39.es/ecma402/#sec-formatdatetimetoparts
 * @param dtf DateTimeFormat
 * @param x
 */
function formatDateTimeParts(dtf: DateTimeFormat, x: number) {
  return partitionDateTimePattern(dtf, x);
}

function getApplicableZoneData(t: number, timeZone: string): [number, boolean] {
  const {tzData} = DateTimeFormat;
  const zoneData = tzData[timeZone];
  // We don't have data for this so just say it's UTC
  if (!zoneData) {
    return [0, false];
  }
  let i = 0;
  let offset = 0;
  let dst = false;
  for (; i <= zoneData.length; i++) {
    if (i === zoneData.length || zoneData[i][0] * 1e3 >= t) {
      [, , offset, dst] = zoneData[i - 1];
      break;
    }
  }
  return [offset * 1e3, dst];
}

/**
 * https://tc39.es/ecma402/#sec-tolocaltime
 * @param t
 * @param calendar
 * @param timeZone
 */
function toLocalTime(
  t: number,
  calendar: string,
  timeZone: string
): {
  weekday: number;
  era: string;
  year: number;
  relatedYear: undefined;
  yearName: undefined;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  inDST: boolean;
  timeZoneOffset: number;
} {
  invariant(typeof t === 'number', 'invalid time');
  invariant(
    calendar === 'gregory',
    'We only support Gregory calendar right now'
  );
  const [timeZoneOffset, inDST] = getApplicableZoneData(t, timeZone);

  const tz = t + timeZoneOffset;
  const year = YearFromTime(tz);
  return {
    weekday: WeekDay(tz),
    era: year < 0 ? 'BC' : 'AD',
    year,
    relatedYear: undefined,
    yearName: undefined,
    month: MonthFromTime(tz),
    day: DateFromTime(tz),
    hour: HourFromTime(tz),
    minute: MinFromTime(tz),
    second: SecFromTime(tz),
    inDST,
    // IMPORTANT: Not in spec
    timeZoneOffset,
  };
}

export interface DateTimeFormatConstructor {
  new (
    locales?: string | string[],
    options?: DateTimeFormatOptions
  ): DateTimeFormat;
  (
    locales?: string | string[],
    options?: DateTimeFormatOptions
  ): DateTimeFormat;

  __addLocaleData(...data: RawDateTimeLocaleData[]): void;
  supportedLocalesOf(
    locales: string | string[],
    options?: Pick<DateTimeFormatOptions, 'localeMatcher'>
  ): string[];
  getDefaultLocale(): string;

  __defaultLocale: string;
  __defaultTimeZone: string;
  __setDefaultTimeZone(tz: string): void;
  getDefaultTimeZone(): string;
  localeData: Record<string, DateTimeFormatLocaleInternalData>;
  availableLocales: string[];
  polyfilled: boolean;
  tzData: Record<string, UnpackedZoneData[]>;
  __addTZData(d: PackedData): void;
}

export interface DateTimeFormat {
  resolvedOptions(): ResolvedDateTimeFormatOptions;
  formatToParts(x?: number | Date): DateTimeFormatPart[];
  format(x?: number | Date): string;
}

export const DateTimeFormat = function (
  this: DateTimeFormat,
  locales?: string | string[],
  options?: DateTimeFormatOptions
) {
  // Cannot use `new.target` bc of IE11 & TS transpiles it to something else
  if (!this || !(this instanceof DateTimeFormat)) {
    return new DateTimeFormat(locales, options);
  }

  initializeDateTimeFormat(this, locales, options);

  /** IMPL START */
  const internalSlots = getInternalSlots(this);

  const dataLocale = internalSlots.dataLocale;
  const dataLocaleData = DateTimeFormat.localeData[dataLocale];
  invariant(
    dataLocaleData !== undefined,
    `Cannot load locale-dependent data for ${dataLocale}.`
  );
  /** IMPL END */
} as DateTimeFormatConstructor;

// Static properties
defineProperty(DateTimeFormat, 'supportedLocalesOf', {
  value: function supportedLocalesOf(
    locales: string | string[],
    options?: Pick<DateTimeFormatOptions, 'localeMatcher'>
  ) {
    return SupportedLocales(
      DateTimeFormat.availableLocales,
      ((Intl as any).getCanonicalLocales as typeof getCanonicalLocales)(
        locales
      ),
      options as any
    );
  },
});

defineProperty(DateTimeFormat.prototype, 'resolvedOptions', {
  value: function resolvedOptions() {
    if (typeof this !== 'object' || !(this instanceof DateTimeFormat)) {
      throw TypeError(
        'Method Intl.DateTimeFormat.prototype.resolvedOptions called on incompatible receiver'
      );
    }
    const internalSlots = getInternalSlots(this);
    const ro: Record<string, unknown> = {};
    for (const key of RESOLVED_OPTIONS_KEYS) {
      let value = internalSlots[key];
      if (key === 'hourCycle') {
        const hour12 =
          value === 'h11' || value === 'h12'
            ? true
            : value === 'h23' || value === 'h24'
            ? false
            : undefined;
        if (hour12 !== undefined) {
          ro.hour12 = hour12;
        }
      }
      if (DATE_TIME_PROPS.indexOf(key as TABLE_6) > -1) {
        if (
          internalSlots.dateStyle !== undefined ||
          internalSlots.timeStyle !== undefined
        ) {
          value = undefined;
        }
      }

      if (value !== undefined) {
        ro[key] = value;
      }
    }
    return ro as any;
  },
});

defineProperty(DateTimeFormat.prototype, 'formatToParts', {
  value: function formatToParts(date?: number | Date) {
    if (date === undefined) {
      date = Date.now();
    } else {
      date = ToNumber(date);
    }
    return formatDateTimeParts(this, date);
  },
});

const DEFAULT_TIMEZONE =
  (typeof process !== 'undefined' && process.env && process.env.TZ) || 'UTC';

DateTimeFormat.__setDefaultTimeZone = (timeZone: string) => {
  if (timeZone !== undefined) {
    timeZone = String(timeZone);
    if (!isValidTimeZoneName(timeZone)) {
      throw new RangeError('Invalid timeZoneName');
    }
    timeZone = canonicalizeTimeZoneName(timeZone);
  } else {
    timeZone = DEFAULT_TIMEZONE;
  }
  DateTimeFormat.__defaultTimeZone = timeZone;
};

DateTimeFormat.__defaultTimeZone = DEFAULT_TIMEZONE;
DateTimeFormat.getDefaultTimeZone = () => DateTimeFormat.__defaultTimeZone;

DateTimeFormat.__addLocaleData = function __addLocaleData(
  ...data: RawDateTimeLocaleData[]
) {
  for (const datum of data) {
    const availableLocales: string[] = datum.availableLocales;
    for (const locale of availableLocales) {
      try {
        const {
          dateFormat,
          timeFormat,
          dateTimeFormat,
          formats,
          ...rawData
        } = unpackData(locale, datum);
        const processedData: DateTimeFormatLocaleInternalData = {
          ...rawData,
          dateFormat: {
            full: parseDateTimeSkeleton(dateFormat.full),
            long: parseDateTimeSkeleton(dateFormat.long),
            medium: parseDateTimeSkeleton(dateFormat.medium),
            short: parseDateTimeSkeleton(dateFormat.short),
          },
          timeFormat: {
            full: parseDateTimeSkeleton(timeFormat.full),
            long: parseDateTimeSkeleton(timeFormat.long),
            medium: parseDateTimeSkeleton(timeFormat.medium),
            short: parseDateTimeSkeleton(timeFormat.short),
          },
          dateTimeFormat: {
            full: parseDateTimeSkeleton(dateTimeFormat.full).pattern,
            long: parseDateTimeSkeleton(dateTimeFormat.long).pattern,
            medium: parseDateTimeSkeleton(dateTimeFormat.medium).pattern,
            short: parseDateTimeSkeleton(dateTimeFormat.short).pattern,
          },
          formats: {},
        };

        for (const calendar in formats) {
          processedData.formats[calendar] = Object.keys(
            formats[calendar]
          ).map(skeleton =>
            parseDateTimeSkeleton(skeleton, formats[calendar][skeleton])
          );
        }

        DateTimeFormat.localeData[locale] = processedData;
      } catch (e) {
        // Ignore if we got no data
      }
    }
  }
  DateTimeFormat.availableLocales = Object.keys(DateTimeFormat.localeData);
  if (!DateTimeFormat.__defaultLocale) {
    DateTimeFormat.__defaultLocale = DateTimeFormat.availableLocales[0];
  }
};

Object.defineProperty(DateTimeFormat.prototype, 'format', formatDescriptor);

DateTimeFormat.__defaultLocale = '';
DateTimeFormat.localeData = {};
DateTimeFormat.availableLocales = [];
DateTimeFormat.getDefaultLocale = () => {
  return DateTimeFormat.__defaultLocale;
};
DateTimeFormat.polyfilled = true;
DateTimeFormat.tzData = {};
DateTimeFormat.__addTZData = function (d: PackedData) {
  DateTimeFormat.tzData = unpack(d);
};

try {
  if (typeof Symbol !== 'undefined') {
    Object.defineProperty(DateTimeFormat.prototype, Symbol.toStringTag, {
      value: 'Intl.DateTimeFormat',
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }

  Object.defineProperty(DateTimeFormat.prototype.constructor, 'length', {
    value: 1,
    writable: false,
    enumerable: false,
    configurable: true,
  });
} catch (e) {
  // Meta fix so we're test262-compliant, not important
}
