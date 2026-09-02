# Recommended Hyper-V VM settings

Sizing and settings for the ScoutIQ VM (§4). These are recommendations, not
requirements: the application reads no VM property and works with more or fewer
resources (§3).

> The host already runs a Debian VM with a Minecraft server. **Do not modify
> it.** ScoutIQ gets its own VM and the two workloads stay isolated (§1, §91).

## Host

```
FIREBAT A6 · AMD Ryzen 7 7735HS · 16 GB RAM · Windows 11 Pro · Hyper-V
```

## Recommended ScoutIQ VM

| Setting | Value | Why |
| --- | --- | --- |
| Generation | 2 | UEFI, modern virtual hardware |
| Secure Boot | Off (or Microsoft UEFI CA) | Debian's installer is not signed by the default CA |
| vCPU | 4 | Analytics is the CPU-hungry part; it runs in the worker |
| Startup RAM | 6 GB | PostgreSQL 2 GB + workers + web with headroom |
| Dynamic Memory | Optional, 4-12 GB | Leaves room for the Minecraft VM |
| Disk | 80-120 GB dynamically expanding VHDX | Event data grows with each imported season |
| Network | External virtual switch | Gives the VM its own LAN address |
| Checkpoints | Production checkpoints only | Standard checkpoints can catch PostgreSQL mid-write |
| Automatic start | Start, delayed | Let the host settle first |

Leave roughly 6 GB for Windows and the Minecraft VM. With both VMs running the
host is comfortable, not tight.

## Creating the VM

PowerShell as Administrator:

```powershell
New-VM -Name "scoutiq" -Generation 2 `
  -MemoryStartupBytes 6GB `
  -NewVHDPath "D:\Hyper-V\scoutiq\scoutiq.vhdx" -NewVHDSizeBytes 120GB `
  -SwitchName "External"

Set-VM -Name "scoutiq" -ProcessorCount 4 `
  -DynamicMemory -MemoryMinimumBytes 4GB -MemoryMaximumBytes 12GB `
  -AutomaticStartAction Start -AutomaticStartDelay 120 `
  -AutomaticStopAction ShutDown `
  -CheckpointType Production

Set-VMFirmware -VMName "scoutiq" -EnableSecureBoot Off
Add-VMDvdDrive -VMName "scoutiq" -Path "D:\iso\debian-13-netinst.iso"
Start-VM -Name "scoutiq"
```

If you have no External switch yet:

```powershell
New-VMSwitch -Name "External" -NetAdapterName "Ethernet" -AllowManagementOS $true
```

## Storage placement

| What | Where | Why |
| --- | --- | --- |
| VHDX | Host SSD | PostgreSQL is latency-sensitive |
| Live database | Inside the VM, Docker named volume | Never on a network share (§18, §92) |
| Backups, raw datasets, reports | DS920+ via a mount inside the VM | See [nas.md](nas.md) |

## Resource limits inside the VM

`docker-compose.prod.yml` sets memory limits sized for 6 GB:

```env
POSTGRES_MEMORY_LIMIT=2G
API_MEMORY_LIMIT=1G
WORKER_MEMORY_LIMIT=1G
REDIS_MEMORY_LIMIT=320M
WORKER_CONCURRENCY=2
```

Raise them if you give the VM more RAM. Nothing in the application assumes any
particular value.

## Verifying isolation from the Minecraft VM

```powershell
Get-VM | Select-Object Name, State, CPUUsage, MemoryAssigned, Uptime
```

The two VMs share only the host and the virtual switch: separate disks,
separate memory, separate operating systems. ScoutIQ never touches the
Minecraft VM, and nothing in this repository configures it.

## Next

Install Debian and Docker: [debian-vm.md](debian-vm.md).
