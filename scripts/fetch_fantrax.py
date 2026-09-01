from fantraxapi import League

LEAGUE_ID = "xa7tza2hmthqz8bo"

print("Connecting to Fantrax...")
print(f"League ID: {LEAGUE_ID}")

league = League(LEAGUE_ID)

print("Connection created successfully.")

print("\nGetting league information...")

try:
    standings = league.standings()

    print("\nFantrax standings response:")
    print(standings)

except Exception as e:
    print("\nSomething went wrong:")
    print(type(e).__name__)
    print(e)
