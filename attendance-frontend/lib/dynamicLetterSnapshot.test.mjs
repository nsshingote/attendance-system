import assert from "node:assert/strict";
import test from "node:test";
import { getGeneratedLetterKind, isDynamicLetterSnapshot } from "./dynamicLetterSnapshot.ts";

test("recognizes serialized dynamic snapshots returned by the documents API before type dispatch", () => {
  for (const documentType of ["offer_letter", "appointment_letter"]) {
    const apiDocument = {
      id: 42,
      document_type: documentType,
      title: documentType === "offer_letter" ? "Offer Letter" : "Appointment Letter",
      content: JSON.stringify({
        format: "dynamic_letter_v1",
        template_name: documentType === "offer_letter" ? "Offer Letter" : "Appointment Letter",
        template_content: "<p>{{employee_name}}</p>",
        resolved_content: "<p>Anuj Mishra</p>",
        placeholder_values: { employee_name: "Anuj Mishra" },
        template_layout: [{ fragments: [{ blockIndex: 0, start: 0, end: 19, text: "<p>Anuj Mishra</p>" }] }],
        layout_validated: true,
      }),
    };
    const snapshot = JSON.parse(apiDocument.content);

    assert.equal(isDynamicLetterSnapshot(snapshot), true);
    assert.equal(getGeneratedLetterKind(apiDocument.document_type, snapshot), "dynamic");
  }
});

test("keeps structured offer and appointment API documents on their existing renderer and PDF paths", () => {
  for (const documentType of ["offer_letter", "appointment_letter"]) {
    const apiDocument = {
      document_type: documentType,
      content: JSON.stringify({ employee_name: "Anuj Mishra", designation: "Inspector" }),
    };
    const values = JSON.parse(apiDocument.content);

    assert.equal(isDynamicLetterSnapshot(values), false);
    assert.equal(getGeneratedLetterKind(apiDocument.document_type, values), documentType === "appointment_letter" ? "appointment" : "offer");
  }
  assert.equal(isDynamicLetterSnapshot(null), false);
  assert.equal(getGeneratedLetterKind("custom", { resolved_content: "Saved custom letter" }), "dynamic");
});
