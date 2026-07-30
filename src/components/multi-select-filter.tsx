import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronDown } from "lucide-react";

// Checkbox-list multi-select in a popover, first built for the KPI
// Worklist's filter row — shared here so other screens (CR Repository,
// etc.) don't each carry their own copy of the same widget.
export function MultiSelectFilter({
  label,
  values,
  onChange,
  options,
  placeholder,
  triggerClassName = "w-48",
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  options: { v: string; l: string }[];
  placeholder: string;
  triggerClassName?: string;
}) {
  const toggle = (v: string) => {
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className={`justify-between font-normal ${triggerClassName}`}>
            <span className="truncate">
              {values.length === 0 ? placeholder : `${values.length} selected`}
            </span>
            <ChevronDown className="size-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="start">
          <ScrollArea className="h-56">
            <div className="p-2 space-y-1">
              {options.map((o) => (
                <label
                  key={o.v}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm"
                >
                  <Checkbox checked={values.includes(o.v)} onCheckedChange={() => toggle(o.v)} />
                  <span className="truncate">{o.l}</span>
                </label>
              ))}
              {options.length === 0 && (
                <div className="text-xs text-muted-foreground p-2">No options.</div>
              )}
            </div>
          </ScrollArea>
          {values.length > 0 && (
            <div className="border-t p-2">
              <Button variant="ghost" size="sm" className="w-full" onClick={() => onChange([])}>
                Clear
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
