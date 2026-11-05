using System.IO;
using System.Linq;
using NUnit.Framework;
using VoxelValley.Core;

namespace VoxelValley.Tests
{
    public class WaterTests
    {
        [Test]
        public void LowGroundFloodsUpToSeaLevel()
        {
            var gen = new TerrainGenerator(1234);
            int flooded = 0;
            for (int cx = -4; cx < 4; cx++)
            for (int cz = -4; cz < 4; cz++)
            {
                var chunk = gen.Generate(new ChunkCoord(cx, cz));
                for (int x = 0; x < Chunk.Size; x++)
                for (int z = 0; z < Chunk.Size; z++)
                {
                    int top = gen.SurfaceHeight(chunk.WorldX(x), chunk.WorldZ(z));
                    if (top >= TerrainGenerator.SeaLevel) continue;
                    flooded++;
                    Assert.AreEqual(BlockId.Water, chunk.Get(x, TerrainGenerator.SeaLevel, z));
                    Assert.AreEqual(BlockId.Air, chunk.Get(x, TerrainGenerator.SeaLevel + 1, z));
                    Assert.AreEqual(BlockId.Sand, chunk.Get(x, top, z), "lake beds are sand");
                }
            }
            Assert.Greater(flooded, 0, "expected some water in 64 chunks");
        }

        [Test]
        public void WaterGoesToItsOwnMeshAndShowsOnlyAgainstAir()
        {
            var c = new Chunk(new ChunkCoord(0, 0));
            c.Set(5, 5, 5, BlockId.Water);
            c.Set(6, 5, 5, BlockId.Water);
            c.Set(5, 4, 5, BlockId.Stone);
            var solid = new MeshData();
            var water = new MeshData();
            ChunkMesher.Build(c, (x, y, z) => BlockId.Air, solid, water);
            Assert.AreEqual(6, solid.FaceCount, "stone under water keeps all faces");
            // Two water blocks: 10 outer faces, minus the bottom of (5,5,5) resting on stone.
            Assert.AreEqual(9, water.FaceCount);
            float maxY = Enumerable.Range(0, water.VertexCount).Max(i => water.Positions[i * 3 + 1]);
            Assert.AreEqual(5 + ChunkMesher.WaterSurface, maxY, 1e-4, "surface sits below the block top");
        }

        [Test]
        public void PlacingIntoWaterIsAllowedButWaterCannotBeBroken()
        {
            var eye = new Vec3(0.5f, 11.6f, 0.5f);
            Assert.AreEqual(EditResult.Ok,
                EditRules.CanPlace(eye, 1, 10, 0, BlockId.Water, BlockId.Dirt, new Vec3[0]));
            Assert.AreEqual(EditResult.NothingThere, EditRules.CanBreak(eye, 1, 10, 0, BlockId.Water));
        }

        [Test]
        public void PlayersNeverSpawnInWater()
        {
            var world = new VoxelWorld(1234);
            var (x, y, z) = world.FindSpawn(0, 0);
            Assert.AreNotEqual(BlockId.Water, world.GetBlock(x, y, z));
        }
    }

    public class SurvivalTests
    {
        [Test]
        public void BlocksHaveSensibleHardnessAndDrops()
        {
            Assert.Less(Blocks.Get(BlockId.Leaves).Hardness, Blocks.Get(BlockId.Dirt).Hardness);
            Assert.Less(Blocks.Get(BlockId.Dirt).Hardness, Blocks.Get(BlockId.Stone).Hardness);
            Assert.IsTrue(float.IsPositiveInfinity(Blocks.Get(BlockId.Bedrock).Hardness));
            Assert.AreEqual(BlockId.Dirt, Blocks.DropOf(BlockId.Grass));
            Assert.AreEqual(BlockId.Stone, Blocks.DropOf(BlockId.Stone));
            Assert.IsFalse(Blocks.IsPlaceable(BlockId.Water));
        }

        [Test]
        public void InventoryAddTakeAndCap()
        {
            var inv = new Inventory();
            Assert.IsFalse(inv.TryTake(BlockId.Stone));
            inv.Add(BlockId.Stone, 3);
            Assert.IsTrue(inv.TryTake(BlockId.Stone, 2));
            Assert.AreEqual(1, inv.Count(BlockId.Stone));
            Assert.IsFalse(inv.TryTake(BlockId.Stone, 2));
            inv.Add(BlockId.Dirt, 5000);
            Assert.AreEqual(Inventory.MaxStack, inv.Count(BlockId.Dirt));
            inv.Add(BlockId.Air, 3);
            Assert.AreEqual(0, inv.Count(BlockId.Air));

            var back = Inventory.Unpack(inv.Pack());
            Assert.AreEqual(1, back.Count(BlockId.Stone));
            Assert.AreEqual(Inventory.MaxStack, back.Count(BlockId.Dirt));
            Assert.Greater(Inventory.Starter().Count(BlockId.Planks), 0);
        }

        [Test]
        public void DaylightIsBrightAtNoonAndDimButVisibleAtMidnight()
        {
            Assert.AreEqual(1f, DayCycle.Daylight(0.25f), 1e-3);
            Assert.That(DayCycle.Daylight(0.75f), Is.InRange(0.2f, 0.3f));
            Assert.IsFalse(DayCycle.IsNight(0.25f));
            Assert.IsTrue(DayCycle.IsNight(0.75f));
            Assert.AreEqual(DayCycle.Daylight(0.3f), DayCycle.Daylight(1.3f), 1e-4);
        }

        [Test]
        public void SaveV2RoundTripAndReadsV1()
        {
            var save = new WorldSave { Seed = 42, TimeOfDay = 0.6f };
            save.Edits.Set(1, 2, 3, BlockId.Brick);
            save.Inventories["탐험가"] = Inventory.Starter();
            save.Inventories["bob"] = new Inventory();
            save.Inventories["bob"].Add(BlockId.Log, 7);

            var stream = new MemoryStream();
            save.Write(stream);
            stream.Position = 0;
            var back = WorldSave.Read(stream);
            Assert.AreEqual(42, back.Seed);
            Assert.AreEqual(0.6f, back.TimeOfDay, 1e-6);
            Assert.AreEqual(BlockId.Brick, back.Edits.All().Single().Id);
            Assert.AreEqual(7, back.Inventories["bob"].Count(BlockId.Log));
            Assert.AreEqual(16, back.Inventories["탐험가"].Count(BlockId.Planks));

            var v1 = new MemoryStream();
            save.Edits.Write(v1, 99);
            v1.Position = 0;
            var old = WorldSave.Read(v1);
            Assert.AreEqual(99, old.Seed);
            Assert.AreEqual(1, old.Edits.Count);
            Assert.IsEmpty(old.Inventories);
        }

        [TestCase("  안녕   하세요  ", "안녕 하세요")]
        [TestCase("<b>bold</b>", "bbold/b")]
        [TestCase("line\nbreak\t!", "line break !")]
        [TestCase("   ", "")]
        public void ChatIsCleaned(string raw, string expected)
        {
            Assert.AreEqual(expected, ChatRules.Clean(raw));
        }

        [Test]
        public void ChatIsCapped()
        {
            Assert.AreEqual(ChatRules.MaxLength, ChatRules.Clean(new string('가', 500)).Length);
        }
    }
}
