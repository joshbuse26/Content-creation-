// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ProjectId, WorkspaceId } from "@/lib/types/ids";
import { ToastProvider } from "@/components/ui/toast";
import { UploadResearchCard } from "../upload-research-card";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001" as WorkspaceId;
const PROJECT_ID = "00000000-0000-4000-8000-0000000000a1" as ProjectId;

function wrap(node: ReactNode) {
  return render(<ToastProvider>{node}</ToastProvider>);
}

function selectFile(file: File) {
  const input = screen.getByLabelText(/upload research file/i);
  fireEvent.change(input, { target: { files: [file] } });
}

const pdf = () => new File(["%PDF-1.4 fake"], "espresso-notes.pdf", { type: "application/pdf" });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("UploadResearchCard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("renders a PDF-capable file picker", () => {
    wrap(
      <UploadResearchCard
        workspaceId={WORKSPACE_ID}
        projectId={PROJECT_ID}
        onUploaded={vi.fn()}
        onTextFile={vi.fn()}
      />,
    );
    const input = screen.getByLabelText(/upload research file/i);
    expect(input.getAttribute("accept")).toContain("application/pdf");
    expect(screen.getByRole("button", { name: /choose file/i })).toBeTruthy();
  });

  it("POSTs the PDF multipart, invalidates, and toasts success on 201", async () => {
    const onUploaded = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ id: "doc1", title: "espresso-notes.pdf", kind: "upload" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    wrap(
      <UploadResearchCard
        workspaceId={WORKSPACE_ID}
        projectId={PROJECT_ID}
        onUploaded={onUploaded}
        onTextFile={vi.fn()}
      />,
    );
    selectFile(pdf());

    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/research-upload");
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body.get("workspaceId")).toBe(WORKSPACE_ID);
    expect(body.get("projectId")).toBe(PROJECT_ID);
    expect(body.get("file")).toBeInstanceOf(File);
    expect(await screen.findByText(/espresso-notes\.pdf/)).toBeTruthy();
  });

  it("surfaces the server error message via toast on a cap error", async () => {
    const onUploaded = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({ error: "upload is 9000 words; the cap on your plan is 5000" }),
      }),
    );
    wrap(
      <UploadResearchCard
        workspaceId={WORKSPACE_ID}
        projectId={PROJECT_ID}
        onUploaded={onUploaded}
        onTextFile={vi.fn()}
      />,
    );
    selectFile(pdf());

    // Surfaced both inline in the card and as a toast.
    expect((await screen.findAllByText(/the cap on your plan is 5000/)).length).toBeGreaterThan(0);
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("maps the scanned/image-only (code:empty) error to a readable message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "no extractable text in the PDF", code: "empty" }),
      }),
    );
    wrap(
      <UploadResearchCard
        workspaceId={WORKSPACE_ID}
        projectId={PROJECT_ID}
        onUploaded={vi.fn()}
        onTextFile={vi.fn()}
      />,
    );
    selectFile(pdf());
    expect(
      (await screen.findAllByText(/couldn’t read text from this pdf/i)).length,
    ).toBeGreaterThan(0);
  });

  it("toasts a connection failure when the fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    wrap(
      <UploadResearchCard
        workspaceId={WORKSPACE_ID}
        projectId={PROJECT_ID}
        onUploaded={vi.fn()}
        onTextFile={vi.fn()}
      />,
    );
    selectFile(pdf());
    expect((await screen.findAllByText(/check your connection/i)).length).toBeGreaterThan(0);
  });

  it("routes .txt/.md files to the tRPC text path, never the PDF route", () => {
    const onTextFile = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    wrap(
      <UploadResearchCard
        workspaceId={WORKSPACE_ID}
        projectId={PROJECT_ID}
        onUploaded={vi.fn()}
        onTextFile={onTextFile}
      />,
    );
    selectFile(new File(["# notes"], "notes.md", { type: "text/markdown" }));
    expect(onTextFile).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unsupported file type without uploading", () => {
    const onTextFile = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    wrap(
      <UploadResearchCard
        workspaceId={WORKSPACE_ID}
        projectId={PROJECT_ID}
        onUploaded={vi.fn()}
        onTextFile={onTextFile}
      />,
    );
    selectFile(new File(["bin"], "image.png", { type: "image/png" }));
    expect(screen.getByText(/unsupported file/i)).toBeTruthy();
    expect(onTextFile).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
