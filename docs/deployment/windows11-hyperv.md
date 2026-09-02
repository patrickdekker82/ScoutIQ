# Windows 11 + Hyper-V host

This describes the **host** side of the current home environment. ScoutIQ
itself never runs on Windows and knows nothing about Hyper-V: it runs inside a
Debian VM, in Docker. Everything here is host preparation you can throw away
when you move to a VPS.

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
New-VMSwitch -Name "ScoutIQ-External" -NetAdapterName "Ethernet" -AllowManagementOS $true
```

## 3. Create the VM

```powershell
New-VM -Name "scoutiq-debian" -Generation 2 `
  -MemoryStartupBytes 8GB `
  -NewVHDPath "D:\Hyper-V\scoutiq\scoutiq.vhdx" -NewVHDSizeBytes 120GB `
  -SwitchName "ScoutIQ-External"

Set-VM -Name "scoutiq-debian" -ProcessorCount 4 `
  -DynamicMemory -MemoryMinimumBytes 4GB -MemoryMaximumBytes 12GB `
  -AutomaticStartAction Start -AutomaticStopAction ShutDown

# Debian's installer is not signed by Microsoft's UEFI CA.
Set-VMFirmware -VMName "scoutiq-debian" -EnableSecureBoot Off

Add-VMDvdDrive -VMName "scoutiq-debian" -Path "D:\iso\debian-13-netinst.iso"
Start-VM -Name "scoutiq-debian"
```

Sizing guidance: 4 vCPU / 8 GB / 120 GB comfortably runs the full stack with
several seasons of match data. Keep the VHDX on an SSD.

## 4. Install Debian

Follow [debian-vm.md](debian-vm.md). Nothing in that guide is Hyper-V-specific.

## 5. Reaching the VM

Give the VM a **DHCP reservation** in your router rather than a static IP in
the VM, and reach it by hostname:

```
http://scoutiq.lan:3000
```

> ScoutIQ never stores an IP address. `PUBLIC_BASE_URL` is the only place a
> hostname appears, and it exists purely to build links inside reports. Change
> it in `.env` and restart - no rebuild.

## 6. Optional: pass NAS storage through

Do **not** mount the Synology on Windows and pass it into the VM. Mount it
inside the Debian VM instead (see [nas.md](nas.md)) so the mount survives a
move to any other host.

## 7. Backups of the VM itself

Hyper-V checkpoints are **not** a database backup - they can capture PostgreSQL
mid-write. Use `npm run db:backup` (see [backup.md](backup.md)) for anything
you actually intend to restore.

## What you leave behind on migration

| Hyper-V specific | Replacement on a VPS |
| --- | --- |
| Virtual switch | Provider network |
| VHDX disk | Block storage volume |
| Checkpoints | Provider snapshots |
| DHCP reservation | DNS A/AAAA record |

None of it appears in the application, its images or its configuration.
