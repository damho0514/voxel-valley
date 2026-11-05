using System;
using System.Linq;
using System.Threading.Tasks;
using Unity.Netcode.Transports.UTP;
using Unity.Services.Authentication;
using Unity.Services.Core;
using Unity.Services.Relay;
using Unity.Services.Relay.Models;
using UnityEngine;

namespace VoxelValley
{
    /// <summary>
    /// Online play through Unity Relay: the host gets a short join code that
    /// works across networks, no port forwarding needed. Requires the project
    /// to be linked to a Unity Cloud project.
    /// </summary>
    public static class RelayConnector
    {
        public const int MaxPlayers = 8;
        const string Protocol = "dtls";

        public static bool IsCloudLinked => !string.IsNullOrEmpty(Application.cloudProjectId);

        /// <summary>Relay join codes are 6 letters/digits; IP addresses contain dots or colons.</summary>
        public static bool LooksLikeJoinCode(string s)
        {
            s = s?.Trim() ?? "";
            return s.Length == 6 && s.All(char.IsLetterOrDigit);
        }

        static async Task SignInAsync()
        {
            if (!IsCloudLinked) throw new InvalidOperationException("not linked");
            if (UnityServices.State == ServicesInitializationState.Uninitialized)
                await UnityServices.InitializeAsync();
            while (UnityServices.State == ServicesInitializationState.Initializing)
                await Task.Yield();
            if (!AuthenticationService.Instance.IsSignedIn)
                await AuthenticationService.Instance.SignInAnonymouslyAsync();
        }

        /// <summary>Allocates a relay and points the transport at it. Returns the join code.</summary>
        public static async Task<string> HostAsync(UnityTransport transport)
        {
            await SignInAsync();
            var allocation = await RelayService.Instance.CreateAllocationAsync(MaxPlayers - 1);
            var code = await RelayService.Instance.GetJoinCodeAsync(allocation.AllocationId);
            transport.SetRelayServerData(allocation.ToRelayServerData(Protocol));
            return code;
        }

        public static async Task JoinAsync(UnityTransport transport, string joinCode)
        {
            await SignInAsync();
            var allocation = await RelayService.Instance.JoinAllocationAsync(joinCode.Trim().ToUpperInvariant());
            transport.SetRelayServerData(allocation.ToRelayServerData(Protocol));
        }

        /// <summary>A short Korean explanation for the menu.</summary>
        public static string Explain(Exception e)
        {
            if (!IsCloudLinked) return "온라인 방은 아직 준비 중이에요. (Unity 클라우드 프로젝트 연결 필요)";
            if (e is RelayServiceException r)
            {
                if (r.Reason == RelayExceptionReason.JoinCodeNotFound || r.Reason == RelayExceptionReason.InvalidRequest)
                    return "참가 코드를 찾을 수 없어요. 코드를 다시 확인해 주세요.";
                if (r.Reason == RelayExceptionReason.AllocationNotFound)
                    return "방이 이미 닫혔어요.";
            }
            if (e is RequestFailedException) return "온라인 서비스에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.";
            Debug.LogWarning($"[VoxelValley] Relay error: {e}");
            return "온라인 연결에 실패했어요. 잠시 후 다시 시도해 주세요.";
        }
    }
}
