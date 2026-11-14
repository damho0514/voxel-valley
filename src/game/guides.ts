import { BLOCKS } from './blocks';
import { Bot } from './bots';
import { DARK_GATE } from './dimensions';
import { GUIDES } from './people';
import { HEIGHT, World } from './world';

/**
 * Where the four guides stand, relative to the dark gate (portal at cx-1..cx, z): two flank the
 * approach right in front of it, two wait a little further out. All face the way you come from.
 */
const SPOTS: [dx: number, dz: number][] = [[-3.5, 4.5], [2.5, 4.5], [-5, 8.5], [4, 8.5]];

/** Feet height on top of the ground at a column. */
function standY(world: World, x: number, z: number) {
  let y = HEIGHT - 2;
  while (y > 0 && !BLOCKS[world.get(Math.floor(x), y, Math.floor(z))].solid) y--;
  return y + 1;
}

/** The guides at the dark gate in the valley. Tap one to talk (they answer by voice). */
export function spawnGuides(world: World): Bot[] {
  return GUIDES.map((p, i) => {
    const x = DARK_GATE.cx + SPOTS[i][0], z = DARK_GATE.z + SPOTS[i][1];
    const y = standY(world, x, z);
    const bot = new Bot(`guide-${p.look}`, p.name, p.color, x, y, z, Math.random);
    bot.look = p.look;
    bot.speed = p.speed;
    bot.followChance = 0;
    bot.post = { x, y, z, yaw: Math.PI };
    return bot;
  });
}
