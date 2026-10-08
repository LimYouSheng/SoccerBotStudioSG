import { readFileSync } from "node:fs";
export async function seedFoundation(mf, db) {
  await db.exec(
    readFileSync("migrations/0005_foundation_identity.sql", "utf8")
      .replace(/^--.*$/gm, "")
      .replace(/\n/g, " "),
  );
  const ns = await mf.getDurableObjectNamespace("COORDINATOR");
  await db
    .prepare("INSERT INTO foundation_identity VALUES(1,?,?,?,?)")
    .bind(
      "517f4f85eb8f982b483dbc05b797fd88",
      "developer",
      "297a991b-70a7-438d-a0e3-39fa3a7f2cee",
      ns.idFromName("simplybook-developer-account").toString(),
    )
    .run();
}
