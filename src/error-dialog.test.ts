import { describe, it, expect } from "vitest";
import { errorDialogHtml, issueUrl, OFFLINE_TITLE, OFFLINE_FIRST_RUN_BODY } from "./error-dialog";

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

describe("errorDialogHtml offline variant", () => {
  it("uses a custom title and omits the issue link when showReportLink is false", () => {
    const html = errorDialogHtml(OFFLINE_FIRST_RUN_BODY, { title: OFFLINE_TITLE, showReportLink: false });
    expect(html).toContain("Can't reach MVSEP");
    expect(html).not.toContain("issues/new");
  });
  it("still escapes the body", () => {
    const html = errorDialogHtml("<script>x</script>", { showReportLink: false });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>x");
  });
  it("default behavior is unchanged (title + issue link present)", () => {
    const html = errorDialogHtml("boom");
    expect(html).toContain("Couldn't separate stems");
    expect(html).toContain("issues/new");
  });
});
