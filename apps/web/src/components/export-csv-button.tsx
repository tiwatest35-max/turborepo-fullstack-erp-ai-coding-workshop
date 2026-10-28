import { Button } from '@/components/ui/button';

/** The "export this report as CSV" button, with its own error message (RPT-04). */
export function ExportCsvButton({
  onExport,
  pending,
  failed,
  disabled = false,
}: {
  onExport: () => void;
  pending: boolean;
  failed: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-4">
      <Button type="button" variant="outline" disabled={disabled || pending} onClick={onExport}>
        ส่งออก CSV
      </Button>
      {failed && (
        <p role="alert" className="text-destructive">
          ส่งออกรายงานไม่สำเร็จ โปรดลองอีกครั้ง
        </p>
      )}
    </div>
  );
}
