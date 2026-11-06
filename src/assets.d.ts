// Metro turns audio imports into asset module ids.
declare module '*.wav' {
  const asset: number;
  export default asset;
}
