import { describe, it, expect } from "vitest";
import { errorDialogHtml, issueUrl } from "./error-dialog";

describe("errorDialogHtml", () => {
  it("escapes HTML metacharacters in the message", () => {
    const html = errorDialogHtml("bad <b>&</b> token");
    expect(html).toContain("bad &lt;b&gt;&amp;&lt;/b&gt; token");
    expect(html).not.toContain("<b>&</b> token");
  });
  it("includes an OK button", () => {
    const html = errorDialogHtml("oops");
    expect(html).toContain('id="ok"');
    expect(html).toContain("oops");
  });
  it("offers a GitHub issue link for the AbleVSEP repo", () => {
    const html = errorDialogHtml("boom failure");
    expect(html).toContain("github.com/madisonrickert/ablevsep");
  });
});

describe("issueUrl", () => {
  it("builds a prefilled new-issue URL containing the error message", () => {
    const url = issueUrl("boom failure");
    expect(url).toContain("https://github.com/madisonrickert/ablevsep/issues/new");
    expect(url).toContain(encodeURIComponent("boom failure"));
    expect(url).toContain("labels=bug");
  });
});
