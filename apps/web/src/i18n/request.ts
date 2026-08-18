import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    // The Indian lakh/crore grouping is mandatory (docs/06 §5). Getting this
    // wrong is the single most obvious tell that a product wasn't built for
    // India, and a government audience spots it instantly.
    formats: {
      number: {
        integer: { maximumFractionDigits: 0 },
        pcu: { maximumFractionDigits: 1 },
        percent: { style: "percent", maximumFractionDigits: 1 },
      },
      dateTime: {
        short: { day: "numeric", month: "short", year: "numeric" },
        time: { hour: "2-digit", minute: "2-digit", hour12: false },
      },
    },
    timeZone: "Asia/Kolkata",
  };
});
