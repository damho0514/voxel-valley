using System.IO;
using System.Linq;
using NUnit.Framework;
using VoxelValley.Core;

namespace VoxelValley.Tests
{
    public class NoiseTests
    {
        [Test]
        public void SameSeedSameValues_DifferentSeedDifferentValues()
        {
            var a = new Noise(42); var b = new Noise(42); var c = new Noise(43);
            Assert.AreEqual(a.Fractal(12.3f, -45.6f, 4), b.Fractal(12.3f, -45.6f, 4));
            Assert.AreNotEqual(a.Fractal(12.3f, -45.6f, 4), c.Fractal(12.3f, -45.6f, 4));
        }

        [Test]
        public void ValuesStayInUnitRange()
        {
            var n = new Noise(7);
            for (int i = -200; i < 200; i += 7)
            {
                float v = n.Fractal(i * 0.37f, i * -0.21f, 4);
                Assert.That(v, Is.InRange(0f, 1f));
            }
        }

        [Test]
        public void FloorToIntHandlesNegatives()
        {
            Assert.AreEqual(-1, Noise.FloorToInt(-0.5f));
            Assert.AreEqual(-2, Noise.FloorToInt(-1.01f));
            Assert.AreEqual(3, Noise.FloorToInt(3.99f));
        }
    }

    public class ChunkTests
    {
        [TestCase(0, 0)] [TestCase(15, 0)] [TestCase(16, 1)] [TestCase(-1, -1)] [TestCase(-16, -1)] [TestCase(-17, -2)]
        public void BlockToChunkCoordinate(int block, int chunk)
        {
            Assert.AreEqual(chunk, ChunkCoord.FromBlock(block, block).X);
            Assert.That(ChunkCoord.Mod(block, Chunk.Size), Is.InRange(0, Chunk.Size - 1));
        }

        [Test]
        public void OutOfBoundsReadsAirAndWritesAreIgnored()
        {
            var c = new Chunk(new ChunkCoord(0, 0));
            c.Set(-1, 5, 0, BlockId.Stone);
            Assert.AreEqual(BlockId.Air, c.Get(-1, 5, 0));
            Assert.AreEqual(BlockId.Air, c.Get(0, Chunk.Height, 0));
        }
    }

    public class TerrainTests
    {
        readonly TerrainGenerator _gen = new TerrainGenerator(1234);

        [Test]
        public void ColumnsHaveBedrockStoneAndSurface()
        {
            var chunk = _gen.Generate(new ChunkCoord(3, -2));
            for (int x = 0; x < Chunk.Size; x += 5)
            for (int z = 0; z < Chunk.Size; z += 5)
            {
                Assert.AreEqual(BlockId.Bedrock, chunk.Get(x, 0, z));
                int top = _gen.SurfaceHeight(chunk.WorldX(x), chunk.WorldZ(z));
                var surface = chunk.Get(x, top, z);
                Assert.That(surface, Is.EqualTo(BlockId.Grass).Or.EqualTo(BlockId.Sand).Or.EqualTo(BlockId.Log),
                    $"surface at {x},{top},{z}");
                Assert.AreEqual(BlockId.Stone, chunk.Get(x, 1, z));
            }
        }

        [Test]
        public void GenerationIsDeterministic()
        {
            var a = _gen.Generate(new ChunkCoord(-5, 9));
            var b = new TerrainGenerator(1234).Generate(new ChunkCoord(-5, 9));
            for (int i = 0; i < Chunk.Volume; i++) Assert.AreEqual(a.GetIndex(i), b.GetIndex(i));
        }

        [Test]
        public void SomeChunksHaveTreesAndTheyStayInsideTheChunk()
        {
            int logs = 0;
            for (int cx = 0; cx < 6; cx++)
            for (int cz = 0; cz < 6; cz++)
            {
                var chunk = _gen.Generate(new ChunkCoord(cx, cz));
                for (int i = 0; i < Chunk.Volume; i++)
                    if (chunk.GetIndex(i) == BlockId.Log) logs++;
                // Trunks keep 2 blocks from the border so the 5-wide crown fits
                // inside this chunk and never needs the neighbour's data.
                for (int y = 0; y < Chunk.Height; y++)
                for (int x = 0; x < Chunk.Size; x++)
                for (int z = 0; z < Chunk.Size; z++)
                {
                    if (chunk.Get(x, y, z) != BlockId.Log) continue;
                    Assert.That(x, Is.InRange(2, Chunk.Size - 3));
                    Assert.That(z, Is.InRange(2, Chunk.Size - 3));
                }
            }
            Assert.Greater(logs, 0, "expected at least one tree in 36 chunks");
        }
    }

    public class MesherTests
    {
        static BlockId Air(int x, int y, int z) => BlockId.Air;

        static Chunk With(params (int x, int y, int z, BlockId id)[] blocks)
        {
            var c = new Chunk(new ChunkCoord(0, 0));
            foreach (var b in blocks) c.Set(b.x, b.y, b.z, b.id);
            return c;
        }

        [Test]
        public void LoneBlockHasSixFaces()
        {
            var m = ChunkMesher.Build(With((5, 5, 5, BlockId.Stone)), Air);
            Assert.AreEqual(6, m.FaceCount);
            Assert.AreEqual(36, m.Triangles.Count);
            Assert.AreEqual(m.VertexCount * 2, m.Uvs.Count);
            Assert.AreEqual(m.VertexCount, m.Shades.Count);
        }

        [Test]
        public void TouchingOpaqueBlocksHideSharedFaces()
        {
            var m = ChunkMesher.Build(With((5, 5, 5, BlockId.Stone), (6, 5, 5, BlockId.Dirt)), Air);
            Assert.AreEqual(10, m.FaceCount);
        }

        [Test]
        public void GlassShowsWhatIsBehindIt()
        {
            var m = ChunkMesher.Build(With((5, 5, 5, BlockId.Stone), (6, 5, 5, BlockId.Glass)), Air);
            Assert.AreEqual(12 - 1, m.FaceCount, "stone keeps its face behind glass; glass hides its face against stone");
            var glass = ChunkMesher.Build(With((5, 5, 5, BlockId.Glass), (6, 5, 5, BlockId.Glass)), Air);
            Assert.AreEqual(10, glass.FaceCount, "glass-glass shares no inner faces");
        }

        [Test]
        public void BordersAskTheNeighbourLookup()
        {
            var chunk = With((0, 5, 0, BlockId.Stone));
            var open = ChunkMesher.Build(chunk, Air);
            var closed = ChunkMesher.Build(chunk, (x, y, z) => BlockId.Stone);
            Assert.AreEqual(6, open.FaceCount);
            Assert.AreEqual(4, closed.FaceCount, "-X and -Z faces are hidden by the neighbouring chunk");
        }

        [Test]
        public void UvsStayInsideTheAtlas()
        {
            var m = ChunkMesher.Build(new TerrainGenerator(9).Generate(new ChunkCoord(0, 0)), Air);
            Assert.Greater(m.FaceCount, 0);
            Assert.That(m.Uvs.All(u => u > 0f && u < 1f));
        }
    }

    public class WorldEditTests
    {
        [Test]
        public void EditsSurviveChunkRegeneration()
        {
            var world = new VoxelWorld(5);
            int top = world.SpawnHeight(-20, 33);
            world.SetBlock(-20, top, 33, BlockId.Brick);
            world.Unload(ChunkCoord.FromBlock(-20, 33));
            Assert.AreEqual(BlockId.Brick, world.GetBlock(-20, top, 33));
            Assert.AreEqual(top + 1, world.SpawnHeight(-20, 33));
        }

        [Test]
        public void SpawnIsOnOpenGroundWithHeadroom()
        {
            var world = new VoxelWorld(1234);
            for (int i = 0; i < 20; i++)
            {
                var (x, y, z) = world.FindSpawn(i * 37 - 300, i * -53 + 200);
                Assert.That(world.GetBlock(x, y - 1, z), Is.EqualTo(BlockId.Grass).Or.EqualTo(BlockId.Sand));
                Assert.AreEqual(BlockId.Air, world.GetBlock(x, y, z));
                Assert.AreEqual(BlockId.Air, world.GetBlock(x, y + 1, z));
            }
        }

        [Test]
        public void SaveRoundTrip()
        {
            var edits = new WorldEdits();
            edits.Set(1, 2, 3, BlockId.Glass);
            edits.Set(-17, 40, 99, BlockId.Air);
            edits.Set(1, 2, 3, BlockId.Planks); // overwrite, still one entry
            Assert.AreEqual(2, edits.Count);

            var stream = new MemoryStream();
            edits.Write(stream, 777);
            stream.Position = 0;
            var loaded = new WorldEdits();
            Assert.AreEqual(777, WorldEdits.Read(stream, loaded));
            CollectionAssert.AreEquivalent(
                edits.All().Select(e => (e.X, e.Y, e.Z, e.Id)),
                loaded.All().Select(e => (e.X, e.Y, e.Z, e.Id)));
        }

        [Test]
        public void PackUnpackForNetwork()
        {
            var list = new[] { new BlockEdit(-3, 10, 4, BlockId.Stone), new BlockEdit(100, 63, -100, BlockId.Air) };
            var back = WorldEdits.Unpack(WorldEdits.Pack(list)).ToArray();
            Assert.AreEqual(2, back.Length);
            Assert.AreEqual(-3, back[0].X); Assert.AreEqual(BlockId.Air, back[1].Id);
            Assert.IsEmpty(WorldEdits.Unpack(new[] { 0, 0, 0, 999 }), "unknown ids are dropped");
        }
    }

    public class EditRuleTests
    {
        static readonly Vec3 Eye = new Vec3(0.5f, 11.6f, 0.5f);

        [Test]
        public void BreakingRules()
        {
            Assert.AreEqual(EditResult.Ok, EditRules.CanBreak(Eye, 2, 9, 0, BlockId.Stone));
            Assert.AreEqual(EditResult.TooFar, EditRules.CanBreak(Eye, 30, 9, 0, BlockId.Stone));
            Assert.AreEqual(EditResult.NothingThere, EditRules.CanBreak(Eye, 2, 9, 0, BlockId.Air));
            Assert.AreEqual(EditResult.Unbreakable, EditRules.CanBreak(Eye, 0, 6, 0, BlockId.Bedrock));
        }

        [Test]
        public void PlacingRules()
        {
            var feet = new[] { new Vec3(0.5f, 10f, 0.5f), new Vec3(3.5f, 10f, 0.5f) };
            Assert.AreEqual(EditResult.Ok, EditRules.CanPlace(Eye, 1, 10, 0, BlockId.Air, BlockId.Brick, feet));
            Assert.AreEqual(EditResult.InsidePlayer, EditRules.CanPlace(Eye, 0, 11, 0, BlockId.Air, BlockId.Brick, feet));
            Assert.AreEqual(EditResult.InsidePlayer, EditRules.CanPlace(Eye, 3, 10, 0, BlockId.Air, BlockId.Brick, feet),
                "can't trap another player");
            Assert.AreEqual(EditResult.Occupied, EditRules.CanPlace(Eye, 1, 10, 0, BlockId.Dirt, BlockId.Brick, feet));
            Assert.AreEqual(EditResult.NotPlaceable, EditRules.CanPlace(Eye, 1, 10, 0, BlockId.Air, BlockId.Bedrock, feet));
            Assert.AreEqual(EditResult.OutOfWorld, EditRules.CanPlace(Eye, 1, 0, 0, BlockId.Air, BlockId.Brick, feet));
        }
    }
}
