import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, safeFilename } from '@/app/api/v1/imports/files/route';

/**
 * Upload safety for the import centre (§55).
 *
 * A filename arrives from a browser and is used to build a storage key, so it
 * is untrusted input: the tests below are the boundary.
 */
describe('safeFilename', () => {
  it('accepts the names the CSV provider expects', () => {
    expect(safeFilename('players.csv')).toBe('players.csv');
    expect(safeFilename('players-eredivisie 2025.csv')).toBe('players-eredivisie 2025.csv');
    expect(safeFilename('bundle.json')).toBe('bundle.json');
    expect(safeFilename('TEAMS.CSV')).toBe('TEAMS.CSV');
  });

  it('strips any directory a browser or a caller supplies', () => {
    expect(safeFilename('C:\\Users\\scout\\players.csv')).toBe('players.csv');
    expect(safeFilename('/home/scout/players.csv')).toBe('players.csv');
  });

  it('refuses to escape the inbox', () => {
    expect(safeFilename('../../etc/passwd')).toBeNull();
    expect(safeFilename('..%2Fplayers.csv')).toBeNull();
    expect(safeFilename('../players.csv')).toBe('players.csv');
  });

  it('refuses anything that is not a CSV or JSON file', () => {
    expect(safeFilename('players.xlsx')).toBeNull();
    expect(safeFilename('run.sh')).toBeNull();
    expect(safeFilename('players.csv.exe')).toBeNull();
    expect(safeFilename('players')).toBeNull();
  });

  it('refuses hidden files, empty names and exotic characters', () => {
    expect(safeFilename('.env.json')).toBeNull();
    expect(safeFilename('')).toBeNull();
    expect(safeFilename('   ')).toBeNull();
    expect(safeFilename('play;rm -rf.csv')).toBeNull();
    expect(safeFilename('players\u0000.csv')).toBeNull();
  });

  it('caps the upload size well below anything that would exhaust the disk', () => {
    expect(MAX_UPLOAD_BYTES).toBe(64 * 1024 * 1024);
  });
});
