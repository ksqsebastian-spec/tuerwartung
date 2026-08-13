/** Cheatsheets werden von esbuild als Text eingebunden (loader `.md: text`). */
declare module "*.md" {
  const inhalt: string;
  export default inhalt;
}
