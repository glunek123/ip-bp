export declare function verifyCaseSecondInstanceMigration(): Promise<{
  migrationCount: number;
  priorMigrationCount: number;
  emptyRoundTable: boolean;
  oldChainPreserved: boolean;
  guardsEnabled: boolean;
  oldFactImmutable: boolean;
  oldChainImmutable: boolean;
  pointerDetachRejected: boolean;
  arbitraryRoundRejected: boolean;
  invalidRejected: boolean;
  atomic: boolean;
  rollbackGuardsRestored: boolean;
  retry: boolean;
}>;
