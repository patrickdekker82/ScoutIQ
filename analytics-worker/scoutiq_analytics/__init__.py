"""Optional numerical analytics service for ScoutIQ (§82).

Stateless by design: it receives arrays, returns arrays, and never touches the
database. That keeps it deployable anywhere - or not at all.
"""

__version__ = "0.1.0"

PITCH_LENGTH_M = 105.0
PITCH_WIDTH_M = 68.0
