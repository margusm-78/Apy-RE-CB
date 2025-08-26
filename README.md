# Coldwell Banker Jacksonville Agents → Brevo CSV (Apify Actor)

**New fix:** harvests agent links from anchors, **data-href/data-url/to**, JSON-LD, and **relative URL regex** (e.g., `/fl/jacksonville/agents/<slug>/aid-<id>`). Also always appends office pages to your start list so it doesn't stall on an empty city page.

If the first list page still yields 0, the actor saves **list_page_debug.html** and **list_page_debug.png** for inspection.

Run → Download `brevo.csv` (EMAIL,FIRSTNAME,LASTNAME,SMS) from the Key-Value store.
