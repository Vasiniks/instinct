"""0-1 prior per joker, read off his spoken verdicts and stated comparisons, within rarity."""
PRIOR = {
    # Commons (judged against commons)
    "Joker": 0.4, "Jolly Joker": 0.45, "Droll Joker": 0.6, "Mad Joker": 0.55, "Crazy Joker": 0.5,
    "Zany Joker": 0.3, "Hanging Chad": 0.95, "Photograph": 0.75, "Crafty Joker": 0.35,
    "Clever Joker": 0.35, "Sly Joker": 0.3, "Wily Joker": 0.25, "Devious Joker": 0.28,
    "Gluttonous Joker": 0.85, "Lusty Joker": 0.8, "Greedy Joker": 0.85, "Wrathful Joker": 0.85,
    "Half Joker": 0.85, "Abstract Joker": 0.85, "Odd Todd": 0.9, "Even Steven": 0.88,
    "Delayed Gratification": 0.45, "Gros Michel": 0.85, "Cavendish": 0.85, "Credit Card": 0.4,
    "8 Ball": 0.45, "Raised Fist": 0.75, "Misprint": 0.18, "Mystic Summit": 0.75, "Banner": 0.2,
    "Ice Cream": 0.75, "Blue Joker": 0.45, "Square Joker": 0.05, "Runner": 0.9, "Scholar": 0.2,
    "Walkie Talkie": 0.2, "Scary Face": 0.78, "Smiley Face": 0.85, "Riff-raff": 0.9,
    "Chaos the Clown": 0.55, "Golden Joker": 0.45, "Business Card": 0.6, "Faceless Joker": 0.5,
    "Mail-In Rebate": 0.88, "Superposition": 0.5, "Hallucination": 0.95, "Reserved Parking": 0.2,
    "Golden Ticket": 0.2, "Supernova": 0.2, "To Do List": 0.6, "Ride the Bus": 0.22, "Splash": 0.15,
    "Green Joker": 0.3, "Red Card": 0.25, "Fortune Teller": 0.32, "Juggler": 0.6, "Drunkard": 0.55,
    "Popcorn": 0.75, "Swashbuckler": 0.2, "Shoot the Moon": 0.22, "Egg": None,
    # Uncommons
    "Marble Joker": 0.05, "Flash Card": 0.75, "Mime": 0.4, "Loyalty Card": 0.2, "Dusk": 0.4,
    "Acrobat": 0.6, "Joker Stencil": 0.4, "Fibonacci": 0.85, "Steel Joker": 0.7, "Burglar": 0.45,
    "Hack": 0.35, "Pareidolia": 0.2, "Space Joker": 0.22, "Blackboard": 0.72, "Ceremonial Dagger": 0.75,
    "Sixth Sense": 0.15, "Constellation": 0.88, "Vampire": 0.88, "Trading Card": 0.9, "Hiker": 0.7,
    "Card Sharp": 0.65, "Madness": 0.2, "Seance": 0.2, "Hologram": 0.7, "Throwback": 0.15,
    "Cloud 9": 0.45, "To the Moon": 0.4, "Satellite": 0.18, "Rocket": 0.75, "Gift Card": 0.75,
    "Midas Mask": 0.75, "Luchador": 0.35, "Turtle Bean": 0.5, "Erosion": 0.45, "Stone Joker": 0.5,
    "Lucky Cat": 0.95, "Bull": 0.95, "Bootstraps": 0.9, "Diet Cola": 0.25, "Spare Trousers": 0.75,
    "Ramen": 0.6, "Seltzer": 0.55, "Castle": 0.5, "Mr. Bones": 0.35, "Sock and Buskin": 0.4,
    "Troubadour": None, "Certificate": 0.2, "Smeared Joker": 0.2, "Bloodstone": 0.15,
    "Onyx Agate": 0.85, "Arrowhead": 0.8, "Rough Gem": 0.25, "Glass Joker": 0.15, "Showman": 0.15,
    "Flower Pot": 0.1, "Merry Andy": 0.45, "Oops! All 6s": 0.7, "The Idol": 0.1,
    "Seeing Double": 0.75, "Cartomancer": 0.9, "Matador": 0.65, "Astronomer": 0.7,
    "Four Fingers": None, "Shortcut": None,
    # Rares
    "Blueprint": 0.95, "Burnt Joker": 0.8, "Obelisk": 0.6, "Stuntman": 0.85, "The Duo": 0.5,
    "The Trio": 0.5, "The Order": 0.45, "The Tribe": 0.4, "The Family": 0.35, "Baseball Card": 0.95,
    "Brainstorm": 0.7, "DNA": 0.15, "Baron": 0.8, "Invisible Joker": None, "Vagabond": 0.1,
    "Campfire": 0.8, "Hit the Road": 0.3, "Wee Joker": None, "Driver's License": 0.4,
    "Ancient Joker": 0.2,
    # Legendaries
    "Yorick": 0.95, "Canio": 0.85, "Triboulet": 0.85, "Perkeo": 0.75, "Chicot": 0.65,
}
NOTE = {"Obelisk": "row is Expelled for not being fun; he calls it 'very strong', so the prior follows the power remark",
        "Vagabond": "expelled for being a lot of work", "Chicot": "held down for making the game boring",
        "Flash Card": "captions say 'JJ'; name inferred from 'scales with rerolls'"}
