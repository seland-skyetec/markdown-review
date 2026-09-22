import { test, expect, type Page } from "@playwright/test";

const id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const source = `# Rapport

## Arkitektur

Dette er **første** setning med [en lenke][docs]. Dette er den andre setningen.

Her er et helt nytt avsnitt. Samme setning. Samme setning.

### Lagring

Originalen lagres privat. Kommentarene beholdes.

### Sikkerhet

Agenten får bare lesetilgang.

## Evaluering

Dette er en annen hovedseksjon.

[docs]: https://example.com
`;

async function setup(page: Page, readOnly = false, legacy = false) {
  const state = {
    id, filename: "rapport.md", source, sourceAvailable: true, retention: "1w", reviewedBlockIds: [] as string[],
    annotations: legacy ? [{ id: "legacy", blockId: "b-3", quote: "Dette er første setning med en lenke.", comment: "Eksisterende kommentar", createdAt: "2026-09-22T20:00:00Z" }] : [] as any[],
  };
  const writes: any[] = [];
  if (!readOnly) await page.addInitScript((key) => localStorage.setItem(`markdown-review:${key}:editToken`, "test-edit-token"), id);
  await page.route(`**/api/reviews/${id}`, async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      writes.push(body);
      await new Promise((resolve) => setTimeout(resolve, 120));
      state.annotations = body.annotations;
      state.reviewedBlockIds = body.reviewedBlockIds;
      await route.fulfill({ json: { ok: true } });
    } else await route.fulfill({ json: state });
  });
  await page.goto(`/?review=${id}`);
  await expect(page.getByRole("heading", { name: "Arkitektur", exact: true })).toBeVisible();
  return { state, writes };
}

async function openOutline(page: Page) {
  const toggle = page.getByRole("button", { name: "Innhold", exact: true });
  if (await toggle.isVisible()) await toggle.click();
}

test("whole chapters, nested headings and hover annotations preserve the Markdown", async ({ page }, info) => {
  const { state } = await setup(page);
  await expect(page.getByRole("heading", { name: "Lagring", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sikkerhet", exact: true })).toBeVisible();
  await expect(page.getByText("Her er et helt nytt avsnitt.", { exact: true })).toBeVisible();
  await expect(page.getByText("Dette er en annen hovedseksjon.", { exact: true })).toHaveCount(0);
  await expect(page.locator(".markdown-body strong")).toHaveText("første");
  await expect(page.locator(".markdown-body a").first()).toHaveAttribute("href", "https://example.com");
  const sentence = page.getByRole("button", { name: "Kommenter: Dette er første setning med en lenke.", exact: true });
  await page.screenshot({ path: `test-results/${info.project.name}-sections.png`, fullPage: true });
  if (info.project.name !== "mobile") {
    await sentence.hover();
    await expect(sentence).toHaveCSS("background-color", "rgba(52, 107, 241, 0.153)");
  }
  await sentence.click();
  await page.getByRole("textbox", { name: "Kommentar til valgt setning" }).fill("Begrunn dette valget.");
  await page.screenshot({ path: `test-results/${info.project.name}-comment.png`, fullPage: true });
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page.locator(".sentence.annotated")).toHaveCount(1);
  await expect.poll(() => state.annotations.length).toBe(1);
  expect(state.annotations[0].sectionId).toBeTruthy();
  expect(state.annotations[0].anchor.exact).toBe("Dette er første setning med en lenke.");
  expect(state.source).toBe(source);
  await page.reload();
  await expect(page.locator(".sentence.annotated")).toHaveCount(1);
});

test("right-aligned section checkbox persists without jumping; children aggregate", async ({ page }) => {
  const { state } = await setup(page);
  const check = page.getByRole("checkbox", { name: "Gjennomgått: Arkitektur", exact: true });
  const title = page.getByRole("heading", { name: "Arkitektur", exact: true });
  const a = await check.boundingBox();
  const b = await title.boundingBox();
  expect(a!.x).toBeGreaterThan(b!.x + b!.width);
  await check.check();
  await expect(page.getByRole("checkbox", { name: "Gjennomgått: Lagring", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Gjennomgått: Sikkerhet", exact: true })).toBeChecked();
  await expect(title).toBeVisible();
  await expect(title).toHaveCSS("color", "rgb(116, 213, 162)");
  await expect.poll(() => state.reviewedBlockIds.length).toBe(3);
  await page.getByRole("checkbox", { name: "Gjennomgått: Lagring", exact: true }).uncheck();
  await expect(check).toHaveJSProperty("indeterminate", true);
  await expect.poll(() => state.reviewedBlockIds.length).toBe(2);
});

test("outline contains only headings, supports collapsing and jumps within / between chapters", async ({ page }) => {
  await setup(page);
  await openOutline(page);
  const outline = page.getByRole("navigation", { name: "Overskrifter" });
  await expect(outline.locator(".outline-link")).toHaveCount(5);
  await expect(outline.locator(".outline-children .outline-children")).toHaveCount(1);
  await outline.getByRole("button", { name: "Skjul underoverskrifter: Arkitektur", exact: true }).click();
  await expect(outline.getByRole("button", { name: "Lagring", exact: true })).not.toBeVisible();
  await outline.getByRole("button", { name: "Vis underoverskrifter: Arkitektur", exact: true }).click();
  await outline.getByRole("button", { name: "Lagring", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Lagring", exact: true })).toBeVisible();
  await openOutline(page);
  await outline.getByRole("button", { name: "Evaluering", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Evaluering", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Arkitektur", exact: true })).toHaveCount(0);
});

test("identical sentences are independent and drafts survive navigation", async ({ page }) => {
  const { state } = await setup(page);
  const twins = page.getByRole("button", { name: "Kommenter: Samme setning.", exact: true });
  await expect(twins).toHaveCount(2);
  await twins.nth(1).click();
  await page.getByRole("textbox", { name: "Kommentar til valgt setning" }).fill("Bare nummer to.");
  await page.getByRole("button", { name: "Lukk panel" }).click();
  await page.getByRole("button", { name: "Neste seksjon" }).click();
  await page.getByRole("button", { name: "Forrige seksjon" }).click();
  await twins.nth(1).click();
  await expect(page.getByRole("textbox", { name: "Kommentar til valgt setning" })).toHaveValue("Bare nummer to.");
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(twins.nth(0)).not.toHaveClass(/annotated/);
  await expect(twins.nth(1)).toHaveClass(/annotated/);
  await expect.poll(() => state.annotations.length).toBe(1);
});

test("legacy comments remain visible and read-only links cannot write", async ({ page }) => {
  const { writes } = await setup(page, true, true);
  await expect(page.locator(".sentence.annotated")).toHaveCount(1);
  await page.locator(".sentence.annotated").click();
  await expect(page.getByText("Eksisterende kommentar", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Kommentar til valgt setning" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Gjennomgått: Arkitektur", exact: true })).toBeDisabled();
  expect(writes).toHaveLength(0);
});

test("save failure is actionable and no agent link is copied before successful persistence", async ({ page }) => {
  await setup(page);
  await page.route(`**/api/reviews/${id}`, async (route) => {
    if (route.request().method() === "PUT") await route.fulfill({ status: 503, json: { error: "test failure" } });
    else await route.fallback();
  });
  await page.getByRole("checkbox", { name: "Gjennomgått: Arkitektur", exact: true }).check();
  await expect(page.getByRole("button", { name: "Prøv igjen", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Kopier lenke", exact: true }).click();
  await expect(page.getByRole("button", { name: "Kopiert", exact: true })).toHaveCount(0);
});
