export declare function verifyCaseSecondInstanceMigration(): Promise<{
  migrationCount: number;
  priorMigrationCount: number;
  prior128Upgraded: boolean;
  prior129Upgraded: boolean;
  emptyRoundTable: boolean;
  oldChainPreserved: boolean;
  combinedDetachRejected: boolean;
  combinedDetachAtomic: boolean;
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
