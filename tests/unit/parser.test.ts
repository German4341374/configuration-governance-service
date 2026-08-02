import { describe, expect, it } from 'vitest';
import { parseConfiguration } from '../../src/configuration/parser.js';

describe('configuration parser', () => {
  it('parses and sorts JSON objects', () => {
    expect(Object.keys(parseConfiguration('{"z":1,"a":2}', 'json'))).toEqual(['a', 'z']);
  });

  it('parses nested YAML', () => {
    expect(parseConfiguration('app:\n  name: api\n  debug: false', 'yaml')).toEqual({
      app: { debug: false, name: 'api' }
    });
  });

  it('parses dotenv exports and quoted values', () => {
    expect(parseConfiguration("export APP_NAME='support api'\nDEBUG=false", 'env')).toEqual({
      APP_NAME: 'support api',
      DEBUG: 'false'
    });
  });

  it('normalizes CRLF and escaped dotenv newlines', () => {
    expect(parseConfiguration('MESSAGE=first\\nsecond\r\n', 'env')).toEqual({
      MESSAGE: 'first\nsecond'
    });
  });

  it('ignores blank lines and comments', () => {
    expect(parseConfiguration('# note\n\nPORT=8080', 'env')).toEqual({ PORT: '8080' });
  });

  it('rejects arrays at the document root', () => {
    expect(() => parseConfiguration('[1,2]', 'json')).toThrow('root must be an object');
  });

  it('rejects malformed JSON', () => {
    expect(() => parseConfiguration('{', 'json')).toThrow('Unable to parse json');
  });

  it('rejects malformed dotenv assignments', () => {
    expect(() => parseConfiguration('MISSING_EQUALS', 'env')).toThrow('line 1');
  });

  it('rejects invalid dotenv keys', () => {
    expect(() => parseConfiguration('NOT-VALID=value', 'env')).toThrow('Invalid .env key');
  });

  it('rejects non-finite YAML numbers', () => {
    expect(() => parseConfiguration('value: .nan', 'yaml')).toThrow(
      'NaN and Infinity are not supported'
    );
  });
});
