using System.Collections.Generic;
using System.Linq;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace VoxelValley
{
    /// <summary>LAN IPv4 addresses others can use to join this device.</summary>
    public static class LocalAddress
    {
        public static List<string> IPv4()
        {
            var result = new List<string>();
            try
            {
                foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (nic.OperationalStatus != OperationalStatus.Up) continue;
                    if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    foreach (var a in nic.GetIPProperties().UnicastAddresses)
                        if (a.Address.AddressFamily == AddressFamily.InterNetwork)
                            result.Add(a.Address.ToString());
                }
            }
            catch (System.Exception)
            {
                // Some platforms restrict interface enumeration.
            }
            // Prefer typical home/office LAN ranges first.
            return result.Distinct()
                .OrderByDescending(ip => ip.StartsWith("192.168.") || ip.StartsWith("10.") || ip.StartsWith("172."))
                .ToList();
        }
    }
}
