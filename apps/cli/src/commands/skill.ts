import { CODEMODE_INSTRUCTIONS } from '../codemode/instructions.js';
import { SPACE_SDK_DECLARATION } from '../codemode/sdk-declaration.js';
import { EXIT } from './aether-home.js';

/*
 * `aether skill` (plan 3.2, section 8.0): the working method and the space
 * SDK declaration for the installed version. The skill folder in every host
 * points here, so an app update updates every host with no relinking.
 */

export function runSkill(): number {
  process.stdout.write(`${CODEMODE_INSTRUCTIONS}\n\nSDK:\n${SPACE_SDK_DECLARATION}\n`);
  return EXIT.done;
}
