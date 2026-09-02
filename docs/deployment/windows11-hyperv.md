# Windows 11 + Hyper-V host

This describes the **host** side of the current home environment. ScoutIQ never
runs on Windows and knows nothing about Hyper-V: it runs inside a Debian VM, in
Docker (§2). Everything here is host preparation you can throw away when you
move to a VPS.

> ## The Minecraft VM is off limits
>
> This host already runs a Debian VM with a Minecraft server. ScoutIQ gets its
> **own, separate VM** and the two workloads stay isolated (§1, §91).
>
> - Do not reconfigure, resize, restart or migrate the Minecraft VM.
> - Do not install ScoutIQ services into it.
> - Do not share a virtual disk between the two.
> - The only thing they share is the host and, optionally, the virtual switch.
>
> Nothing in this repository touches it. If a step here would affect it, stop.

```
Windows 11 Pro
└── Hyper-V
    ├── Debian VM  →  Minecraft server      (existing - leave alone)
    └── Debian VM  →  ScoutIQ               (new)
                      ├── Next.js web
                      ├── PostgreSQL
                      ├── Redis
                      ├── worker
                      └── scheduler
                              ↓
                           DS920+  (backups, datasets, reports)
```

## 1. Enable Hyper-V

PowerShell as Administrator:

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All
```

Reboot when prompted.

## 2. Create a virtual switch

An **External** switch bound to your physical NIC gives the VM its own address
on the LAN, which is what you want for a server:

```powershell
New-VMSwitch -Name "External" -NetAdapterName "Ethernet" -AllowManagementOS $true
```

## 3. Check what the host already runs

Before allocating anything, look at what is already there:

```powershell
Get-VM | Select-Object Name, State, ProcessorCount, MemoryAssigned, Uptime
```

Leave the Minecraft VM's CPU and memory exactly as they are. With 16 GB total,
6 GB for ScoutIQ leaves a comfortable margin for Windows and Minecraft.

## 4. Create the ScoutIQ VM

Full recommended settings are in [hyperv.md](hyperv.md).

```powershell
New-VM -Name "scoutiq" -Generation 2 `
  -MemoryStartupBytes 6GB `
  -NewVHDPath "D:\Hyper-V\scoutiq\scoutiq.vhdx" -NewVHDSizeBytes 120GB `
  -SwitchName "External"

Set-VM -Name "scoutiq" -ProcessorCount 4 `
  -DynamicMemory -MemoryMinimumBytes 4GB -MemoryMaximumBytes 12GB `
  -AutomaticStartAction Start -AutomaticStopAction ShutDown

# Debian's installer is not signed by Microsoft's UEFI CA.
Set-VMFirmware -VMName "scoutiq" -EnableSecureBoot Off

Add-VMDvdDrive -VMName "scoutiq" -Path "D:\iso\debian-13-netinst.iso"
Start-VM -Name "scoutiq"
```

Sizing guidance (§3, §4): 4 vCPU / 6 GB / 120 GB runs the full stack with
several seasons of event data on this host. Keep the VHDX on an SSD.

## 5. Install Debian

Follow [debian-vm.md](debian-vm.md). Nothing in that guide is Hyper-V-specific.

## 6. Reaching the VM

Give the VM a **DHCP reservation** in your router rather than a static IP in
the VM, and reach it by hostname:

```
http://scoutiq.local
```

> ScoutIQ never stores an IP address. `PUBLIC_BASE_URL` is the only place a
> hostname appears, and it exists purely to build links inside reports. Change
> it in `.env` and restart - no rebuild.

## 7. Optional: pass NAS storage through

Do **not** mount the Synology on Windows and pass it into the VM. Mount it
inside the Debian VM instead (see [nas.md](nas.md)) so the mount survives a
move to any other host.

## 8. Backups of the VM itself

Hyper-V checkpoints are **not** a database backup - a standard checkpoint can
capture PostgreSQL mid-write. Use production checkpoints, and use
`npm run db:backup` (see [backups.md](backups.md)) for anything you actually
intend to restore.

## What you leave behind on migration

| Hyper-V specific | Replacement on a VPS |
| --- | --- |
| Virtual switch | Provider network |
| VHDX disk | Block storage volume |
| Checkpoints | Provider snapshots |
| DHCP reservation | DNS A/AAAA record |

None of it appears in the application, its images or its configuration.
