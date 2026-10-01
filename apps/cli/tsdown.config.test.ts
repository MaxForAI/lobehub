import { describe, expect, it, vi } from 'vitest';

import config, { cliConfig, dshRuntimeConfig } from './tsdown.config';

const resolveInputOptions = async () => {
  const { inputOptions } = cliConfig as {
    inputOptions: (options: Record<string, any>, ...rest: any[]) => Promise<any> | any;
  };

  const options: Record<string, any> = {};
  await inputOptions(options, 'esm', { cjsDts: false });

  return options;
};

describe('CLI build configuration', () => {
  it('bundles ws so the desktop-embedded CLI runs without node_modules', () => {
    expect(cliConfig).toEqual(
      expect.objectContaining({
        deps: expect.objectContaining({ alwaysBundle: expect.arrayContaining(['ws']) }),
      }),
    );
  });

  // `spawnDshSdkSession` launches `./dshRuntimeEntry.js` beside the bundle; the
  // single-file CLI build never emits it unless it is its own entry.
  it('emits the DSH runtime entry beside the CLI bundle', () => {
    expect(config).toEqual([cliConfig, dshRuntimeConfig]);
    expect(dshRuntimeConfig.entry).toEqual({
      dshRuntimeEntry: expect.stringMatching(
        /heterogeneous-agents\/src\/spawn\/dshRuntimeEntry\.ts$/,
      ),
    });
    expect(dshRuntimeConfig.clean).toBe(false);
    expect(dshRuntimeConfig.outDir ?? cliConfig.outDir).toBe(cliConfig.outDir);
  });

  it('fails the build instead of externalizing an unresolved import', async () => {
    const { onLog } = await resolveInputOptions();

    expect(() =>
      onLog(
        'warn',
        {
          code: 'UNRESOLVED_IMPORT',
          message: `Could not resolve '@lobechat/device-control' in src/commands/connect.ts`,
        },
        vi.fn(),
      ),
    ).toThrow('@lobechat/device-control');
  });

  it('forwards every other log to the default handler', async () => {
    const { onLog } = await resolveInputOptions();
    const defaultHandler = vi.fn();
    const log = { code: 'INEFFECTIVE_DYNAMIC_IMPORT', message: 'dynamic import will not move' };

    onLog('warn', log, defaultHandler);

    expect(defaultHandler).toHaveBeenCalledWith('warn', log);
  });
});
