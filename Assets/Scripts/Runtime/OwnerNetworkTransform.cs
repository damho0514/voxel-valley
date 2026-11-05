using Unity.Netcode.Components;

namespace VoxelValley
{
    /// <summary>The owning client moves its own player; others follow.</summary>
    public sealed class OwnerNetworkTransform : NetworkTransform
    {
        protected override bool OnIsServerAuthoritative() => false;
    }
}
