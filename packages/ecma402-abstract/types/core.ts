export type Locale = string;
export interface LocaleData<T> {
  data: Record<Locale, T>;
  availableLocales: string[];
}

export interface LookupMatcherResult {
  locale: string;
  extension?: string;
  nu?: string;
}
