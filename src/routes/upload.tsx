import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload as UploadIcon, FileSpreadsheet } from "lucide-react";
import { importCrCsv, type CsvImportResult } from "@/lib/csv-import";
import { importDefectCsv, type DefectImportResult } from "@/lib/defect-import";
import { recalculateAllKpis } from "@/lib/kpi-engine";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppUser } from "@/lib/app-user";

export const Route = createFileRoute("/upload")({
  head: () => ({ meta: [{ title: "Data Import · Kpisavvy" }] }),
  component: UploadPage,
});

function UploadPage() {
  const { isAdmin, role, isLoading } = useAppUser();
  const navigate = useNavigate();
  const canAccess = isAdmin || role === "PMO" || role === "BA" || role === "ITPM";

  useEffect(() => {
    if (!isLoading && !canAccess) navigate({ to: "/" });
  }, [isLoading, canAccess, navigate]);

  if (isLoading || !canAccess) return null;

  return (
    <AppShell>
      <PageHeader
        title="Data Import"
        description="Import Change Requests and Defects. Manual CR fields (Size, Notes) are preserved on re-import."
      />
      <PageBody>
        <Tabs defaultValue="cr" className="space-y-4">
          <TabsList>
            <TabsTrigger value="cr">CR CSV</TabsTrigger>
            <TabsTrigger value="defect">Defect CSV</TabsTrigger>
          </TabsList>
          <TabsContent value="cr"><CrImport /></TabsContent>
          <TabsContent value="defect"><DefectImport /></TabsContent>
        </Tabs>
      </PageBody>
    </AppShell>
  );
}

function CrImport() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const qc = useQueryClient();

  const m = useMutation({
    mutationFn: async (f: File) => {
      const r = await importCrCsv(f);
      const eng = await recalculateAllKpis();
      return { r, eng };
    },
    onSuccess: ({ r, eng }) => {
      setResult(r);
      toast.success(
        `Imported ${r.inserted + r.updated} CR(s) · Engine wrote ${eng.resultsWritten} KPI result(s).`,
      );
      qc.invalidateQueries();
    },
    onError: (e: unknown) =>
      toast.error(`Upload failed: ${e instanceof Error ? e.message : String(e)}`),
  });

  return (
    <>
        <Card>
          <CardHeader>
            <CardTitle>Select CR CSV file</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg py-12 cursor-pointer hover:bg-accent/40 transition-colors">
              <UploadIcon className="size-8 text-muted-foreground mb-3" />
              <div className="text-sm font-medium">
                {file ? file.name : "Click to choose a .csv file"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {file
                  ? `${(file.size / 1024).toFixed(1)} KB`
                  : "Headers must match the CR Portal export."}
              </div>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setResult(null);
                }}
              />
            </label>

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setFile(null);
                  setResult(null);
                }}
                disabled={!file || m.isPending}
              >
                Clear
              </Button>
              <Button onClick={() => file && m.mutate(file)} disabled={!file || m.isPending}>
                {m.isPending ? "Importing & recalculating…" : "Import & Recalculate KPIs"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {result && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="size-4" /> Import summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <Stat label="Rows" value={result.totalRows} />
                <Stat label="Inserted" value={result.inserted} />
                <Stat label="Updated" value={result.updated} />
                <Stat label="Skipped" value={result.skipped} />
              </div>
              {result.errors.length > 0 && (
                <div className="mt-4 text-xs text-destructive max-h-40 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <div key={i}>{e}</div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
    </>
  );
}

function DefectImport() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<DefectImportResult | null>(null);
  const qc = useQueryClient();

  const m = useMutation({
    mutationFn: async (f: File) => importDefectCsv(f),
    onSuccess: (r) => {
      setResult(r);
      toast.success(
        `Imported ${r.imported} defect(s) · Skipped ${r.skipped}.` +
          (r.testCasesFlaggedForRetest > 0
            ? ` ${r.testCasesFlaggedForRetest} test case(s) flagged for retest (defect resolved).`
            : ""),
      );
      qc.invalidateQueries();
    },
    onError: (e: unknown) =>
      toast.error(`Upload failed: ${e instanceof Error ? e.message : String(e)}`),
  });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Select Defect CSV file</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg py-12 cursor-pointer hover:bg-accent/40 transition-colors">
            <UploadIcon className="size-8 text-muted-foreground mb-3" />
            <div className="text-sm font-medium">
              {file ? file.name : "Click to choose a .csv file"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {file
                ? `${(file.size / 1024).toFixed(1)} KB`
                : "Defects with blank or unknown CR No are skipped."}
            </div>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setResult(null);
              }}
            />
          </label>
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              onClick={() => { setFile(null); setResult(null); }}
              disabled={!file || m.isPending}
            >
              Clear
            </Button>
            <Button onClick={() => file && m.mutate(file)} disabled={!file || m.isPending}>
              {m.isPending ? "Importing…" : "Import Defects"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="size-4" /> Import summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4 text-center">
              <Stat label="Total Records" value={result.totalRows} />
              <Stat label="Imported" value={result.imported} />
              <Stat label="Skipped (CR Not Found)" value={result.skipped} />
              <Stat
                label="Test Cases Flagged for Retest"
                value={result.testCasesFlaggedForRetest}
              />
            </div>
            {result.errors.length > 0 && (
              <div className="mt-4 text-xs text-destructive max-h-40 overflow-y-auto">
                {result.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">{label}</div>
    </div>
  );
}