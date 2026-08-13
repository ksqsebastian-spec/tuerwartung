/** Formular-PDFs werden von esbuild als base64 eingebunden (loader `.pdf: base64`). */
declare module "*.pdf" {
  const inhalt: string;
  export default inhalt;
}
