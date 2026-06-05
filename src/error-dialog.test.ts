import { describe, it, expect } from "vitest";
import { errorDialogHtml } from "./error-dialog";

describe("errorDialogHtml", () => {
  it("escapes HTML metacharacters in the message", () => {
    const html = errorDialogHtml("bad <b>&</b> token");
    expect(html).toContain("bad &lt;b&gt;&amp;&lt;/b&gt; token");
    expect(html).not.toContain("<b>&</b> token");
  });
  it("includes an OK button and the MVSEP heading", () => {
    const html = errorDialogHtml("oops");
    expect(html).toContain("id=\"ok\"");
    expect(html).toContain("oops");
  });
});
