import "./testDom";
import { SWRConfig } from "swr";

/* ------------------------------------------------------------------ *
 * Giving a component its data
 *
 * Not by mocking the module: tsx compiles a component's static `import` to
 * `require`, and `mock.module` only intercepts the ESM path — so the test
 * would see the stub while the component quietly used the real SWR. It looks
 * like it works right up until nothing renders.
 *
 * `SWRConfig`'s own `fallback` is the seam the library provides. Data is
 * returned synchronously, the cache is fresh per render, and the fetcher
 * throws — so a key a test forgot to provide fails loudly instead of
 * rendering an empty state that quietly passes.
 * ------------------------------------------------------------------ */

export function withSwr(
  data: Record<string, unknown>,
  children: React.ReactNode,
): React.ReactElement {
  return (
    <SWRConfig
      value={{
        provider: () => new Map(),
        fallback: data,
        /*
         * Fallback data alone is not enough: SWR still revalidates on mount,
         * so `isLoading` stays true and every component renders its loading
         * branch. A test that stubs the data and then asserts against
         * "Loading…" is a test that never sees the component.
         */
        revalidateOnMount: false,
        revalidateIfStale: false,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        fetcher: (key: string) => {
          throw new Error(`test asked for ${key}, which no fixture provides`);
        },
      }}
    >
      {children}
    </SWRConfig>
  );
}
