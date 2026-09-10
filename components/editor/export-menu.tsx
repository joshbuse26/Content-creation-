"use client";

import { useState } from "react";
import type { ScriptId, WorkspaceId } from "@/lib/types/ids";
import { EXPORT_FORMATS, type ExportFormat } from "@/lib/types/enums";
import { trpc } from "@/components/providers/trpc";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { IconDownload } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { downloadFile } from "@/components/lib/download";

const formatLabels: Record<ExportFormat, string> = {
  txt: "Plain text (.txt)",
  md: "Markdown (.md)",
  docx: "Word (.docx)",
  teleprompter: "Teleprompter (.txt, large type)",
};

export function ExportMenu({
  workspaceId,
  scriptId,
}: {
  workspaceId: WorkspaceId;
  scriptId: ScriptId;
}) {
  const utils = trpc.useUtils();
  const [busyFormat, setBusyFormat] = useState<ExportFormat | null>(null);
  const [error, setError] = useState(false);

  const doExport = async (format: ExportFormat) => {
    setBusyFormat(format);
    setError(false);
    try {
      const res = await utils.client.script.export.query({ workspaceId, scriptId, format });
      downloadFile(res.filename, res.mimeType, res.content, res.encoding);
    } catch {
      setError(true);
    } finally {
      setBusyFormat(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Dropdown
        align="right"
        trigger={
          <span className="inline-flex items-center gap-1.5">
            {busyFormat !== null ? <Spinner size={12} /> : <IconDownload size={13} />}
            Export
          </span>
        }
      >
        {(close) => (
          <>
            {EXPORT_FORMATS.map((format) => (
              <DropdownItem
                key={format}
                disabled={busyFormat !== null}
                onSelect={() => {
                  close();
                  void doExport(format);
                }}
              >
                {formatLabels[format]}
              </DropdownItem>
            ))}
          </>
        )}
      </Dropdown>
      {error ? <span className="text-xs text-red-600 dark:text-red-400">Export failed</span> : null}
    </div>
  );
}
