"use client";

import { useState } from "react";
import { skipToken } from "@tanstack/react-query";
import { DESCRIPTION_MODES, type DescriptionMode } from "@/lib/types/enums";
import type { DescriptionTemplateId, WorkspaceId } from "@/lib/types/ids";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { useProjectId } from "@/components/projects/project-frame";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Select, TextArea, TextInput } from "@/components/ui/field";
import { Tabs } from "@/components/ui/tabs";
import { IconCopy, IconPlus, IconSparkle, IconTrash } from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";
import { useToast } from "@/components/ui/toast";
import { extractSlots, fillSlots } from "./template-slots";

const modeLabels: Record<DescriptionMode, string> = {
  informative: "Informative",
  narrative: "Narrative",
  seo: "SEO",
};

/**
 * Three description modes as tabs; generate per mode (optionally through a
 * workspace {{slot}} template), fill leftover slots inline, edit in place.
 * Admins manage templates without leaving the panel.
 */
export function DescriptionsPanel() {
  const { workspaceId, workspace } = useWorkspace();
  const projectId = useProjectId();
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const [mode, setMode] = useState<DescriptionMode>("informative");
  const [draft, setDraft] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<DescriptionTemplateId | null>(null);
  const [slotValues, setSlotValues] = useState<Record<string, string>>({});
  const [manageOpen, setManageOpen] = useState(false);

  const canManageTemplates = workspace?.role === "admin" || workspace?.role === "owner";

  const listQuery = trpc.description.list.useQuery(
    workspaceId !== null ? { workspaceId, projectId } : skipToken,
  );
  const templatesQuery = trpc.templates.list.useQuery(
    workspaceId !== null ? { workspaceId } : skipToken,
  );
  const invalidate = () => {
    if (workspaceId !== null) void utils.description.list.invalidate({ workspaceId, projectId });
  };
  const generateMutation = trpc.description.generate.useMutation({
    onSuccess: () => {
      setDraft(null);
      setSlotValues({});
      invalidate();
    },
    onError: () => {
      toast("Could not generate the description — try again.");
    },
  });
  const updateMutation = trpc.description.update.useMutation({
    onSuccess: () => {
      setDraft(null);
      invalidate();
      toast("Description saved.", "success");
    },
    onError: () => {
      toast("Could not save the description — your draft is still in the editor.");
    },
  });

  if (workspaceId === null || listQuery.isLoading) return <LoadingState />;
  if (listQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void listQuery.refetch();
        }}
      />
    );
  }

  const templates = templatesQuery.data ?? [];
  const current = (listQuery.data ?? []).find((d) => d.mode === mode);
  const body = draft ?? current?.body ?? "";
  const openSlots = current === undefined ? [] : extractSlots(body);

  const generate = () => {
    generateMutation.mutate({ workspaceId, projectId, mode, templateId });
  };

  return (
    <div className="space-y-4">
      <Tabs
        tabs={DESCRIPTION_MODES.map((m) => ({ id: m, label: modeLabels[m] }))}
        active={mode}
        onChange={(m) => {
          setMode(m);
          setDraft(null);
          setSlotValues({});
        }}
      />

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Template" htmlFor="desc-template">
          <Select
            id="desc-template"
            value={templateId ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              const found = templates.find((t) => (t.id as string) === value);
              setTemplateId(found?.id ?? null);
            }}
          >
            <option value="">No template — plain description</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        {canManageTemplates ? (
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={manageOpen}
            onClick={() => {
              setManageOpen((v) => !v);
            }}
          >
            {manageOpen ? "Hide templates" : "Manage templates"}
          </Button>
        ) : null}
      </div>

      {manageOpen && canManageTemplates ? <TemplateManager workspaceId={workspaceId} /> : null}

      {current === undefined ? (
        <EmptyState
          title={`No ${modeLabels[mode].toLowerCase()} description yet`}
          hint="Generated from the finished script, not from scratch. Pick a template to wrap the result in your house format."
          action={
            <Button variant="primary" busy={generateMutation.isPending} onClick={generate}>
              <IconSparkle size={13} /> Generate
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          <TextArea
            aria-label={`${modeLabels[mode]} description`}
            className="min-h-56 font-mono text-[13px]"
            value={body}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
          />

          {openSlots.length > 0 ? (
            <Card>
              <CardBody className="space-y-2">
                <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Fill the template&rsquo;s remaining {"{{slots}}"} — empty fields keep their
                  placeholder.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {openSlots.map((slot) => (
                    <Field key={slot} label={slot} htmlFor={`slot-${slot}`}>
                      <TextInput
                        id={`slot-${slot}`}
                        value={slotValues[slot] ?? ""}
                        placeholder={`Value for {{${slot}}}`}
                        onChange={(e) => {
                          setSlotValues((v) => ({ ...v, [slot]: e.target.value }));
                        }}
                      />
                    </Field>
                  ))}
                </div>
                <Button
                  size="sm"
                  disabled={Object.values(slotValues).every((v) => v.trim() === "")}
                  onClick={() => {
                    setDraft(fillSlots(body, slotValues));
                    setSlotValues({});
                  }}
                >
                  Apply slot values
                </Button>
              </CardBody>
            </Card>
          ) : null}

          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={draft === null || draft === current.body}
              busy={updateMutation.isPending}
              onClick={() => {
                if (draft !== null) {
                  updateMutation.mutate({ workspaceId, descriptionId: current.id, body: draft });
                }
              }}
            >
              Save changes
            </Button>
            <Button size="sm" busy={generateMutation.isPending} onClick={generate}>
              <IconSparkle size={12} /> Regenerate
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(body).catch(() => undefined);
              }}
            >
              <IconCopy size={12} /> Copy
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Inline template CRUD for admins — list, edit in place, create, delete. */
function TemplateManager({ workspaceId }: { workspaceId: WorkspaceId }) {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [newBody, setNewBody] = useState("{{summary}}\n\nChapters:\n{{chapters}}");
  const [edits, setEdits] = useState<Record<string, { name: string; body: string }>>({});

  const templatesQuery = trpc.templates.list.useQuery({ workspaceId });
  const invalidate = () => void utils.templates.list.invalidate({ workspaceId });

  const createMutation = trpc.templates.create.useMutation({
    onSuccess: () => {
      setNewName("");
      invalidate();
      toast("Template created.", "success");
    },
    onError: () => {
      toast("Could not create the template — check the name and try again.");
    },
  });
  const updateMutation = trpc.templates.update.useMutation({
    onSuccess: (t) => {
      setEdits((e) => {
        const { [t.id as string]: _dropped, ...rest } = e;
        return rest;
      });
      invalidate();
      toast("Template saved.", "success");
    },
    onError: () => {
      toast("Could not save the template — your edits are still here.");
    },
  });
  const removeMutation = trpc.templates.remove.useMutation({
    onSuccess: () => {
      invalidate();
      toast("Template deleted.", "success");
    },
    onError: () => {
      toast("Could not delete the template — nothing was changed.");
    },
  });

  if (templatesQuery.isLoading) return <LoadingState />;
  if (templatesQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void templatesQuery.refetch();
        }}
      />
    );
  }
  const templates = templatesQuery.data ?? [];

  return (
    <Card>
      <CardBody className="space-y-4">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Templates wrap generated descriptions. Known slots are filled automatically:{" "}
          {"{{summary}}"}, {"{{title}}"}, {"{{chapters}}"}, {"{{keywords}}"} — anything else stays
          for the writer to fill.
        </p>

        {templates.map((t) => {
          const edit = edits[t.id as string] ?? { name: t.name, body: t.body };
          const dirty = edit.name !== t.name || edit.body !== t.body;
          return (
            <div
              key={t.id}
              className="space-y-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <TextInput
                aria-label={`Template name — ${t.name}`}
                value={edit.name}
                onChange={(e) => {
                  setEdits((prev) => ({
                    ...prev,
                    [t.id as string]: { ...edit, name: e.target.value },
                  }));
                }}
              />
              <TextArea
                aria-label={`Template body — ${t.name}`}
                className="min-h-24 font-mono text-[13px]"
                value={edit.body}
                onChange={(e) => {
                  setEdits((prev) => ({
                    ...prev,
                    [t.id as string]: { ...edit, body: e.target.value },
                  }));
                }}
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={!dirty || edit.name.trim() === ""}
                  busy={updateMutation.isPending && updateMutation.variables.templateId === t.id}
                  onClick={() => {
                    updateMutation.mutate({
                      workspaceId,
                      templateId: t.id,
                      name: edit.name.trim(),
                      body: edit.body,
                    });
                  }}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  busy={removeMutation.isPending && removeMutation.variables.templateId === t.id}
                  onClick={() => {
                    removeMutation.mutate({ workspaceId, templateId: t.id });
                  }}
                >
                  <IconTrash size={12} /> Delete
                </Button>
              </div>
            </div>
          );
        })}

        <form
          className="space-y-2 rounded-md border border-dashed border-zinc-300 p-3 dark:border-zinc-700"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim() === "") return;
            createMutation.mutate({ workspaceId, name: newName.trim(), body: newBody });
          }}
        >
          <Field label="New template name" htmlFor="tpl-new-name">
            <TextInput
              id="tpl-new-name"
              value={newName}
              placeholder="e.g. Gear video default"
              onChange={(e) => {
                setNewName(e.target.value);
              }}
            />
          </Field>
          <Field label="Body" htmlFor="tpl-new-body">
            <TextArea
              id="tpl-new-body"
              className="min-h-20 font-mono text-[13px]"
              value={newBody}
              onChange={(e) => {
                setNewBody(e.target.value);
              }}
            />
          </Field>
          <Button
            type="submit"
            size="sm"
            variant="primary"
            disabled={newName.trim() === ""}
            busy={createMutation.isPending}
          >
            <IconPlus size={12} /> Create template
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
