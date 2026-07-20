import { useRef, useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onLoad: (xml: string, filename?: string) => void;
  onReset: () => void;
  currentSource: "generated" | "custom";
  currentFilename?: string;
}

export function BpmnXmlLoader({ open, onClose, onLoad, onReset, currentSource, currentFilename }: Props) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const submit = (xml: string, filename?: string) => {
    if (!xml.trim()) {
      setErr("Empty XML");
      return;
    }
    if (!xml.includes("<") || !/bpmn[:\s]/i.test(xml)) {
      setErr("Doesn't look like BPMN XML");
      return;
    }
    setErr(null);
    onLoad(xml, filename);
    onClose();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const xml = await f.text();
    submit(xml, f.name);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[min(720px,92vw)] rounded-lg border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div>
            <h2 className="text-sm font-semibold">Load BPMN 2.0 XML</h2>
            <p className="text-[11px] text-muted-foreground">
              Renders any valid <span className="mono">.bpmn</span> / XML file with BPMNDI geometry.
              Runtime state overlays only apply to activities whose id matches the current instance.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >✕</button>
        </div>

        <div className="space-y-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-md border border-border bg-panel-2 px-3 py-1.5 text-xs hover:border-teal hover:text-teal"
            >
              📁 Choose .bpmn / .xml file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".bpmn,.xml,application/xml,text/xml"
              className="hidden"
              onChange={onFile}
            />
            <span className="text-[11px] text-muted-foreground">or paste below</span>
            <div className="ml-auto text-[10px] text-muted-foreground">
              Currently: {currentSource === "custom"
                ? <span className="mono text-teal">{currentFilename ?? "custom XML"}</span>
                : <span className="mono">auto-generated from instance</span>}
            </div>
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='<?xml version="1.0" encoding="UTF-8"?>&#10;<bpmn:definitions ...>&#10;  ...&#10;</bpmn:definitions>'
            className="h-56 w-full resize-none rounded-md border border-border bg-panel-2 p-2 mono text-[11px] text-foreground outline-none focus:border-teal"
            spellCheck={false}
          />

          {err && (
            <div className="rounded-md border border-danger/50 bg-danger/10 px-2 py-1 text-[11px] text-danger">
              {err}
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              onClick={() => { onReset(); onClose(); }}
              disabled={currentSource !== "custom"}
              className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              ↺ Reset to generated
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >Cancel</button>
              <button
                onClick={() => submit(text, "pasted.xml")}
                className="rounded-md bg-teal px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-hover"
              >Render XML</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
