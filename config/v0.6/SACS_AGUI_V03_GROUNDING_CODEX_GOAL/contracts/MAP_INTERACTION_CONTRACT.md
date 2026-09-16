# Map Interaction Contract

## Local navigation
PAN, ZOOM, FIT_LAYER, FIT_FINDING.

## Local inspection
HOVER, INSPECT, FOCUS, FOCUS_PIN, FOCUS_UNPIN, TOGGLE_LAYER.

## Local drafting
DRAW_POINT, DRAW_LINE, DRAW_POLYGON, DRAW_RADIUS, SET_QUERY_SCOPE, REPLACE_QUERY_SCOPE, CLEAR_QUERY_SCOPE.

None of the above may call Analysis Control implicitly.

## Explicit analysis mutations
- SUBMIT_NEW_QUERY
- RESOLVE_SELECTION
- CANCEL_ANALYSIS

A draft geometry is never authoritative until explicit submission succeeds and a new authoritative Revision/Snapshot is observed.
