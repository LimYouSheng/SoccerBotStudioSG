// Build-time public path. Next Link/router add it themselves; native URLs do not.
export const siteBasePath =
  process.env.NEXT_PUBLIC_BASE_PATH ?? "/SoccerBotStudioSG";
if (siteBasePath !== "" && siteBasePath !== "/SoccerBotStudioSG")
  throw new Error("NEXT_PUBLIC_BASE_PATH must be empty or /SoccerBotStudioSG");

export function sitePath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error("Expected a local absolute site path");
  return siteBasePath + path;
}
