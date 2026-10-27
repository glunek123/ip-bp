import type { CreateLeadInput } from '../../api/leads';

export type LeadCsvParsedRow =
  | {
      rowNumber: number;
      status: 'valid';
      input: CreateLeadInput;
      suspectedDuplicates: readonly string[];
      remoteScreenshots?: readonly {
        productNumber: number;
        sourceGroupNumber: number;
        urls: readonly string[];
      }[];
      operatorText?: string;
    }
  | {
      rowNumber: number;
      status: 'invalid';
      errors: readonly string[];
    };

export type LeadCsvPreview = {
  generation: number;
  phase: 'closed' | 'empty' | 'reading' | 'ready' | 'error';
  fileName: string | null;
  rows: readonly LeadCsvParsedRow[];
  selectedRowNumbers: readonly number[];
};

type LeadCsvSelectedInput = Readonly<Omit<CreateLeadInput, 'products'>> & {
  readonly products: readonly Readonly<CreateLeadInput['products'][number]>[];
};

export type LeadCsvSelection = Readonly<{
  generation: number;
  selectionRevision: number;
  rows: readonly Readonly<{
    rowNumber: number;
    input: LeadCsvSelectedInput;
    remoteScreenshots?: readonly {
      productNumber: number;
      sourceGroupNumber: number;
      urls: readonly string[];
    }[];
    operatorText?: string;
  }>[];
}>;

function copyInput(input: CreateLeadInput): CreateLeadInput {
  return {
    ...input,
    infringementTypes: [...input.infringementTypes],
    products: input.products.map((product) => ({ ...product })),
    leadScreenshotContentVersionIds: [...input.leadScreenshotContentVersionIds],
  };
}

function copyRow(row: LeadCsvParsedRow): LeadCsvParsedRow {
  return row.status === 'valid'
    ? {
        rowNumber: row.rowNumber,
        status: 'valid',
        input: copyInput(row.input),
        suspectedDuplicates: [...row.suspectedDuplicates],
        ...(row.remoteScreenshots
          ? {
              remoteScreenshots: row.remoteScreenshots.map((group) => ({
                productNumber: group.productNumber,
                sourceGroupNumber: group.sourceGroupNumber,
                urls: [...group.urls],
              })),
            }
          : {}),
        ...(row.operatorText ? { operatorText: row.operatorText } : {}),
      }
    : { rowNumber: row.rowNumber, status: 'invalid', errors: [...row.errors] };
}

function captureInput(input: CreateLeadInput): LeadCsvSelectedInput {
  const copy = copyInput(input);
  Object.freeze(copy.infringementTypes);
  copy.products.forEach(Object.freeze);
  Object.freeze(copy.products);
  Object.freeze(copy.leadScreenshotContentVersionIds);
  return Object.freeze(copy);
}

/** Receives validated preview rows; parsing, duplicate detection and persistence are external. */
export class LeadCsvPreviewSession {
  private generation = 0;
  private phase: LeadCsvPreview['phase'] = 'closed';
  private fileName: string | null = null;
  private rows: LeadCsvParsedRow[] = [];
  private selectedRowNumbers = new Set<number>();
  private selectionRevision = 0;
  private readonly selections = new WeakSet<LeadCsvSelection>();

  open(): void {
    this.invalidate('empty');
  }

  cancel(): void {
    this.invalidate('closed');
  }

  beginFile(fileName: string): number | null {
    if (this.phase === 'closed') return null;
    this.invalidate('reading');
    this.fileName = fileName;
    return this.generation;
  }

  acceptParsed(generation: number, rows: readonly LeadCsvParsedRow[]): boolean {
    if (this.phase !== 'reading' || generation !== this.generation)
      return false;
    const rowNumbers = rows.map((row) => row.rowNumber);
    if (
      rowNumbers.some(
        (number) => !Number.isSafeInteger(number) || number < 1,
      ) ||
      new Set(rowNumbers).size !== rowNumbers.length
    ) {
      this.invalidate('error');
      return false;
    }
    this.rows = rows.map(copyRow);
    this.phase = 'ready';
    return true;
  }

  failFile(generation: number): boolean {
    if (this.phase !== 'reading' || generation !== this.generation)
      return false;
    this.invalidate('error');
    return true;
  }

  selectRows(generation: number, rowNumbers: readonly number[]): boolean {
    if (this.phase !== 'ready' || generation !== this.generation) return false;
    const validNumbers = new Set(
      this.rows
        .filter((row) => row.status === 'valid')
        .map((row) => row.rowNumber),
    );
    if (rowNumbers.some((number) => !validNumbers.has(number))) return false;
    this.selectedRowNumbers = new Set(rowNumbers);
    this.selectionRevision += 1;
    return true;
  }

  selection(): LeadCsvSelection | null {
    if (this.phase !== 'ready' || this.selectedRowNumbers.size === 0)
      return null;
    const selection: LeadCsvSelection = Object.freeze({
      generation: this.generation,
      selectionRevision: this.selectionRevision,
      rows: Object.freeze(
        this.rows.flatMap((row) =>
          row.status === 'valid' && this.selectedRowNumbers.has(row.rowNumber)
            ? [
                Object.freeze({
                  rowNumber: row.rowNumber,
                  input: captureInput(row.input),
                  ...(row.remoteScreenshots
                    ? {
                        remoteScreenshots: Object.freeze(
                          row.remoteScreenshots.map((group) =>
                            Object.freeze({
                              productNumber: group.productNumber,
                              sourceGroupNumber: group.sourceGroupNumber,
                              urls: Object.freeze([...group.urls]),
                            }),
                          ),
                        ),
                      }
                    : {}),
                  ...(row.operatorText
                    ? { operatorText: row.operatorText }
                    : {}),
                }),
              ]
            : [],
        ),
      ),
    });
    this.selections.add(selection);
    return selection;
  }

  /** Recheck before applying a captured selection. This is not a business authorization check. */
  isCurrentSelection(selection: LeadCsvSelection): boolean {
    return (
      this.selections.has(selection) &&
      this.phase === 'ready' &&
      this.selectedRowNumbers.size > 0 &&
      this.generation === selection.generation &&
      this.selectionRevision === selection.selectionRevision
    );
  }

  snapshot(): LeadCsvPreview {
    return {
      generation: this.generation,
      phase: this.phase,
      fileName: this.fileName,
      rows: this.rows.map(copyRow),
      selectedRowNumbers: [...this.selectedRowNumbers],
    };
  }

  private invalidate(phase: LeadCsvPreview['phase']): void {
    this.generation += 1;
    this.phase = phase;
    this.fileName = null;
    this.rows = [];
    this.selectedRowNumbers.clear();
    this.selectionRevision += 1;
  }
}
