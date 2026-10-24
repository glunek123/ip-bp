export function verifyCaseSecondInstanceNormalSourceMigration(): Promise<{
  upgrade: {
    kind: 'upgrade';
    migrations: 177;
    finalGuard: true;
    rollback: true;
    predecessorProbes: { normal: '23514'; external: 'accepted' };
    probes: {
      normal: 'accepted';
      external: 'accepted';
      wrongChoice: '23514';
      crossCase: '23514';
      wrongDepartment: '23514';
    };
  };
  empty: {
    kind: 'empty';
    migrations: 177;
    finalGuard: true;
    probes: {
      normal: 'accepted';
      external: 'accepted';
      wrongChoice: '23514';
      crossCase: '23514';
      wrongDepartment: '23514';
    };
  };
  publicUnchanged: true;
}>;
