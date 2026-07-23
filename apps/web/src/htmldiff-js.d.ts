// htmldiff-js ships no types. It's a webpack (commonjs2) bundle whose source does
// `export default HtmlDiff` with a static `HtmlDiff.execute(old, new)`. Depending on
// the bundler's interop the default import may be the class or `{ default: class }`,
// so consumers normalise at runtime (see diff-fields.ts).
declare module 'htmldiff-js' {
  interface HtmlDiffStatic {
    execute(oldHtml: string, newHtml: string): string;
  }
  const HtmlDiff: HtmlDiffStatic;
  export default HtmlDiff;
}
