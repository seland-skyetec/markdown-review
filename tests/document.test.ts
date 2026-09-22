import test from "node:test";
import assert from "node:assert/strict";
import { buildDocument, groupSections, legacyBlocks, normaliseReviewed, reviewScope, reviewUnits, sectionForAnnotation } from "../lib/document";

const source = "# Rapport\r\n\r\n## Arkitektur\r\n\r\nFørste avsnitt.\r\n\r\nAndre avsnitt.\r\n\r\n### Lagring\r\n\r\nData lagres privat.\r\n\r\n## Evaluering\r\n\r\nTest løsningen.\r\n";

test("chapters contain all paragraphs and descendants, not the whole document", () => {
  const model = buildDocument(source);
  assert.deepEqual(model.groups.map((id) => model.byId[id].title), ["Arkitektur", "Evaluering"]);
  const visible = groupSections(model, model.groups[0]);
  assert.deepEqual(visible.map((section) => section.title), ["Arkitektur", "Lagring"]);
  const body = source.slice(visible[0].bodyStart, visible[0].end);
  assert.ok(body.includes("Første avsnitt."));
  assert.ok(body.includes("Andre avsnitt."));
  assert.ok(!body.includes("Test løsningen."));
  assert.equal(model.byId[visible[1].parentId!].title, "Arkitektur");
  assert.deepEqual(reviewScope(model, visible[0].id).map((section) => section.title), ["Arkitektur", "Lagring"]);
});

test("AST ignores code-fence hashes and recognizes setext, skipped levels and duplicate headings", () => {
  const model = buildDocument("Tittel\n======\n\n## Del\n\n~~~md\n# Ikke en overskrift\n~~~\n\n#### Dyp\n\nTekst.\n\n## Del\n\nMer.");
  assert.deepEqual(model.sections.map((section) => section.title), ["Tittel", "Del", "Dyp", "Del"]);
  assert.equal(new Set(model.sections.map((section) => section.id)).size, 4);
  assert.equal(model.sections[2].parentId, model.sections[1].id);
});

test("no headings gives one full document; preamble and a title introduction are retained", () => {
  const plain = buildDocument("Ett avsnitt.\n\nEt annet avsnitt.");
  assert.equal(plain.groups.length, 1);
  assert.equal(plain.sections[0].end, plain.source.length);
  const model = buildDocument("Før overskrift.\n\n# Tittel\n\nInnledende tekst.\n\n## A\n\nTekst.");
  assert.deepEqual(model.groups.map((id) => model.byId[id].title), ["Innledning", "Tittel", "A"]);
  assert.equal(groupSections(model, model.wrapperId!).length, 1);
});

test("legacy review status is conservative and original CRLF offsets are retained", () => {
  const model = buildDocument(source);
  assert.equal(normaliseReviewed(model, ["b-3"]).length, 0);
  const all = model.legacyBlocks.map((block) => block.id);
  assert.deepEqual(normaliseReviewed(model, all), reviewUnits(model).map((section) => section.id));
  const old = legacyBlocks(source).find((block) => block.id === "b-3")!;
  assert.equal(source.slice(old.start, old.end), "Første avsnitt.");
  assert.equal(sectionForAnnotation(model, { blockId: "b-3" })?.title, "Arkitektur");
  assert.deepEqual(normaliseReviewed(model, [model.groups[0]]), [model.groups[0]]);
});

test("definitions are available across section boundaries and heading-only parents aggregate descendants", () => {
  const model = buildDocument("# Tittel\n\n## A\n\n### Barn\n\nSe [kilden][ref].\n\n## B\n\nTekst.\n\n[ref]: https://example.com");
  assert.match(model.definitions, /https:\/\/example.com/);
  assert.deepEqual(reviewScope(model, model.groups[0]).map((section) => section.title), ["Barn"]);
  assert.equal(buildDocument("").groups.length, 0);
});
