/** Browser-Skripte werden als Text eingebettet (siehe scripts/bundle.mjs). */
declare module "*.txt" {
  const inhalt: string;
  export default inhalt;
}
