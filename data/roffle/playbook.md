# How Roffle Lite plays Balatro: a playbook

What Roffle Lite does and says across 11 videos (9 Gold-stake runs, 2 White-stake naneinf speedruns), plus BalatroUniversity's "Just. Play. Pairs.". The same content is in `playbook.json`, written for the agent's code to read.

How to read it:

- Each idea is tagged **does** (seen in `decisions.jsonl`), **says** (only in his commentary), or **does+says**.
- Confidence says how consistently he says or does it.
- Quotes are verbatim YouTube auto-captions, checked word for word against the caption track. Misheard names are corrected in [brackets]. Links jump to the second.
- "Ante ~n" is read off the HUD by OCR. It is approximate: older reads sometimes show ante 4 as 5.
- Decks come from the deck-back sprite on screen. Stakes come from the video descriptions; the naneinf runs also show a white stake chip and his own "it is a white stake".

## Sources

| Video | Channel | Deck | Stake | Result | Decision log |
| - | - | - | - | - | - |
| [Is this TOO MUCH SYNERGY???](https://www.youtube.com/watch?v=e-xjK3zeAVM) (`e-xjK3zeAVM`) | Roffle Lite | Ghost | Gold | won (cleared ante 8); died in endless at ante 12, round 34 | yes |
| [I Spent 7 Antes in Debt](https://www.youtube.com/watch?v=OTn6yl2jxGg) (`OTn6yl2jxGg`) | Roffle Lite | Ghost | Gold | won; died in endless at ante 12, round 35 | yes |
| [Loyalty Card was ACTUALLY GOOD???](https://www.youtube.com/watch?v=SkwRy_N5D9A) (`SkwRy_N5D9A`) | Roffle Lite | Ghost | Gold | won; died in endless at ante 11, round 36 | yes |
| [I Was Judged Worthy of this Blueprint](https://www.youtube.com/watch?v=nLdGlAmcWAM) (`nLdGlAmcWAM`) | Roffle Lite | Ghost | Gold | won; died in endless at ante 10, round 32 | yes |
| [I Will NEVER Underestimate this Joker Again](https://www.youtube.com/watch?v=yefo5lyt6wU) (`yefo5lyt6wU`) | Roffle Lite | Checkered | Gold | won; died in endless at ante 11, round 31 | yes |
| [Glass Joker Saves the Day](https://www.youtube.com/watch?v=brRkg1_VFAU) (`brRkg1_VFAU`) | Roffle Lite | Checkered | Gold | won; died in endless in its 13th ante (13 boss blinds in the log; the HUD reads ante 12, round 38) | yes |
| [My Deck is Small but At Least I'm Rich](https://www.youtube.com/watch?v=bb3UmQWsofM) (`bb3UmQWsofM`) | Roffle Lite | Ghost | Gold | won; died in endless in its 13th ante (13 boss blinds in the log; the HUD reads ante 12, round 39) | yes |
| [A Mime Dual Wielding Bananas](https://www.youtube.com/watch?v=LXou4GPdMYY) (`LXou4GPdMYY`) | Roffle Lite | Ghost | Gold | won; died in endless at ante 13, round 37 | no (captions only) |
| [Riff Raff Can Spawn NEGATIVES???](https://www.youtube.com/watch?v=oqiWiv4ygWU) (`oqiWiv4ygWU`) | Roffle Lite | Checkered | Gold | won; died in endless at ante 12, round 36 | no (captions only) |
| [naneinf on Ante 9](https://www.youtube.com/watch?v=-GUBw5pfwWY) (`-GUBw5pfwWY`) | Roffle Lite | Ghost | White | naneinf (score overflow) at ante 9; speedrun | no (captions only) |
| [I naneinf When I Find Baron](https://www.youtube.com/watch?v=IK2QVkr5fzE) (`IK2QVkr5fzE`) | Roffle Lite | Ghost | White | naneinf at ante 11; speedrun (~37 min) | no (captions only) |
| [Just. Play. Pairs. (Gold Stake Lessons)](https://www.youtube.com/watch?v=qpCPl7Yo-pU) (`qpCPl7Yo-pU`) | Balatro University | Checkered | Gold | won the seeded run (seed JNM9VD6W) at Gold stake | no (captions only) |

- `e-xjK3zeAVM`: Took an Eternal Baseball Card from an ante-2 Buffoon pack and stacked Uncommons around it (Vampire, two Constellations, Astronomer, Card Sharp, Midas Mask). A perishable Mail-In Rebate bought in ante 1 paid for the early game. Pair reached level 29.
- `OTn6yl2jxGg`: Used the deck's starting Hex on a shop-1 Credit Card (it became Polychrome), then ran in debt for seven antes feeding Hologram and Constellation from packs, with Blueprint. High Card reached level 26. Late Mime and Steel were not enough.
- `SkwRy_N5D9A`: Weak joker offers all run. A Loyalty Card with six hands a round (active every round), an Eternal Joker Stencil, and non-joker resources (Mercury spam, Steel, Hex, Spectrals) carried it. He calls it a typical Gold-stake situation.
- `nLdGlAmcWAM`: Judgement gave him Blueprint. He then passed the few scoring jokers on offer to keep a High Card plan (Raised Fist, Mail-In Rebate, Square, Steel cards, Glass Joker). He calls it greed, and it ended the run.
- `yefo5lyt6wU`: A Riff-Raff (perishable and rental) spawned commons in ante 2, and flushes carried the early game. A late Eternal Lucky Cat, with Oops! All 6s, two Sock and Buskins, Dusk and Glass, ramped hard. He held many rentals late, with over $100.
- `brRkg1_VFAU`: Bought an Eternal+Rental Brainstorm in ante 2 knowing it would hurt his economy, and later had a double Brainstorm with little worth copying. Space Joker levels carried the early game; Glass Joker plus Justice, then Lucky Cat and Bloodstone, carried the end. His decision log here includes blind selects and rerolls.
- `bb3UmQWsofM`: Mail-In Rebate plus a run of Hermits made him rich early ($99 on the HUD at ante 3). Immolates and a Trading Card cut the deck to 7 cards by ante 8. He moved from flushes to Four of a Kind through Strength (kings, for the purple seals), then Dusk with Golden Ticket. Its decision log (blind selects and rerolls included) landed while this playbook was written.
- `LXou4GPdMYY`: Business Card and Matador early. He bought a speculative Mime with no Steel in the deck and bridged with Two Pair and Four of a Kind until Steel arrived, then wavered between Four of a Kind and High Card. He says he died for not using Ankh on the Mime sooner.
- `oqiWiv4ygWU`: A slow ante 1, then Riff-Raff spawned a Negative Hanging Chad, and the extra slot held utility jokers (DNA, Sixth Sense) for deck fixing. He used Death on purple seals, moved to Four of a Kind and Flush Five, and added Lucky Cat late. Includes his comments on stakes.
- `-GUBw5pfwWY`: Speedrun with the Brainstorm mod set to give a Perkeo in ante 1. A natural Negative Business Card from Judgement plus an early Baron. The rest was making enough Cryptids (Perkeo copies) and finding Mime. Includes his White vs Gold buying remark.
- `IK2QVkr5fzE`: Same Brainstorm-mod Perkeo setup. Copied Immolates cut the deck to 11 cards, and the money engine was Mail-In Rebate, Temperance and Golden Ticket. Baron was the last missing piece.
- `qpCPl7Yo-pU`: Checkered deck makes flushes easy, but that doesn't mean you should play them. Use the free flushes for the first rounds without opening Buffoon packs, find a chips joker (Square Joker), then play Pairs and fill the deck with value cards. Play conservatively early, because lost money compounds through interest.

## The 10 most important ideas

1. **In antes 1–2 put money into jokers that score now or make money, then from ante 3 leave every shop with at least $25 so interest stays capped.** [does+says, high] — "The important thing is we got to an interest breakpoint." (brRkg1_VFAU 5:41)
2. **Take a money joker (Mail-In Rebate, Business Card, Credit Card, Reserved Parking, Golden Ticket) in antes 1–2 even over a small scoring gain.** [does+says, high] — "Like that justifies the mail-in rebate, full stop on its own." (e-xjK3zeAVM 1:17)
3. **Buy a Rental joker only for a job in the next round or two, sell it as soon as the job is done, and keep rentals long only when money is far above the cap.** [does+says, high] — "So many rentals, I feel like I'm in an MTV Cribs video shoot." (yefo5lyt6wU 34:22)
4. **Pass Eternal+Rental jokers unless the joker is a top copy or build-around you would keep all run anyway, and if you take one, start rebuilding the economy at once.** [does+says, high] — "Okay, well, now we're really going to need something to fix our econ because this is going to devastate it." (brRkg1_VFAU 2:12)
5. **Count money in $5 steps and, before cash-out, sell spare items to reach the next breakpoint, holding total rent on top because rent is taken before interest is counted.** [does+says, medium] — "Did get to 18 which is important at least with the rental." (yefo5lyt6wU 3:02)
6. **At Gold stake, buy cheap early scoring (Blue Joker, flat +Mult) in antes 1–2 that you would skip at White stake, where you should bank the money instead.** [does+says, medium] — "I think we [snorts] can buy nothing. It is a white steak [stake]. We don't really need the chips that badly. If there were a gold steak [stake], I'd definitely be taking the uh blue man [Blue Joker] there." (-GUBw5pfwWY 0:57)
7. **At Gold stake, lean on non-joker resources (Planets, Tarots, Spectrals, seals, enhancements) and play whatever the offers support instead of forcing a joker plan.** [says, high] — "When I say you've got to work with what you're given on gold stake, I I mean you've got to work with what you're given and sometimes this is all you're given." (SkwRy_N5D9A 25:38)
8. **At Gold stake, play every small and big blind instead of skipping for tags.** [does, medium] — did: 39 select_blind events over 13 antes (small, big and boss every ante), zero skips
9. **On Checkered, use the free flushes to clear antes 1–2, but don't commit to Flush unless flush payoff jokers arrive; find a chips joker and move to Pairs.** [says, medium] — "The checker deck gives you a huge head start in the direction of playing flushes, but you may not find the game pieces which actually reward you for playing flushes. It may make sense to do something else instead." (BU qpCPl7Yo-pU 0:10)
10. **Judge a joker by this run (hands per round, deck, other jokers), not by its tier; Loyalty Card with six hands a round is a real xMult.** [does+says, high] — "Yeah, it's almost like the jokers depend or the value of the jokers depend on the context in which they are offered, but who would ever say such a thing like that?" (SkwRy_N5D9A 8:18)

Next in weight:

11. When the next boss isn't safely beaten, take the scoring joker even if it doesn't fit the long-term plan.
12. Take a scaling or xMult build-around early even if it is Eternal, then stack the jokers it rewards.
13. When scoring comes from jokers or held cards, pick one cheap hand (High Card or Pair) and pour every matching Planet into it.
14. On Ghost Deck, plan around Spectrals: Hex the lone joker you bought in shop 1 (a money joker, twice) into Polychrome, Immolate for money and thinning, Ankh to double the build-around, and buy single Spectrals before opening a Spectral pack you want a specific card from.
15. Reroll the shop only out of money above the $25 interest floor plus rent, at any ante, and not at all while poor unless the run will die without a piece.

Each idea is set out with its full evidence under its topic below. Evidence marked counterpoint or qualifier cuts against the rule or narrows it.

## What BalatroUniversity says about Pairs

Source: "Just. Play. Pairs. (Gold Stake Lessons)", Checkered Deck at Gold stake, seed JNM9VD6W. Of their Pair videos (also "How to force Pairs, even on the Checkered Deck", "*Another* reason to play Pairs", "Doomsday prepping, when playing Pairs", "Is 'pairslop' always the answer?" and the 96-minute "Balatro Class: How to enable High Card and Pairs"), this is the one whose whole thesis is Pairs.

- A deck's head start toward a hand (Checkered toward flushes) doesn't mean you should play that hand; you may never see the jokers that reward it.
- Use the free flushes to win the first rounds, buy nothing, and don't open the early Buffoon packs. At high stakes they often hold rentals, perishables or eternal rentals, and the money lost compounds through interest.
- Flush payoff jokers (Supernova, Ride the Bus, Green Joker, Red Card) want several flushes a round. If you need four flushes a round you are losing anyway, so once you see one, play Pairs.
- What Pairs needs is a chips source. Early jokers mostly give Mult, and flushes get chips from playing five cards. Once you have a chips joker (Square Joker), the hand stops mattering and you can spam low hands.
- He prefers Square Joker over Constellation early, rental or not and foil or not. Constellation doesn't matter until late ante 3 or ante 4.
- Pairs doesn't care what's in the deck, so every value card is gain: Gold cards, Blue/Purple seals, Stones (Marble Joker), Certificate cards, Hologram.
- Play non-winning hands first to scale ("square up") and finish with the pair. Hold The Hermit until about $19. Take rentals only to use and sell. Pass Eternal Rentals.
- "Best to play as conservatively as possible in the early game. That gives you the money ... to break out in the end game."

## Economy

### In antes 1–2 put money into jokers that score now or make money, then from ante 3 leave every shop with at least $25 so interest stays capped.

`econ.spend-early-then-hold-cap` · said and seen in his decision logs · confidence high · Roffle and BalatroUniversity · when: stakes Gold, antes 1–8, shop

Why: Early money is worth more as a joker that keeps the run alive. Once the board clears blinds, the $5 a round of capped interest is his steadiest income, and he only dips below it for a core piece. BalatroUniversity adds that when the deck already scores (Checkered), you should spend nothing early.

- did (decision logs): Money on leaving the shop, HUD OCR, 6 analysed Gold-stake runs (the debt run OTn6yl2jxGg left out): antes 1–2 median $21 but split, with 47% of exits under $10 (poor starts) and 42% at $25+ (when early money jokers paid); antes 3–4 median $38, 71% at $25+; antes 5–8 median $40, 79%; ante 9+ median $54.5, 93% (n = 19, 21, 89, 27 shop visits).
- said, [brRkg1_VFAU 5:41](https://www.youtube.com/watch?v=brRkg1_VFAU&t=341s), ante ~4: "The important thing is we got to an interest breakpoint."
- said, [e-xjK3zeAVM 3:38](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=218s), ante ~2: "I think I want the money more than I need some scaling right now."
- qualifier, said, [BU qpCPl7Yo-pU 48:23](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=2903s): "best to play as conservatively as possible in the early game. That gives you the money. That gives you the resources to"

Code: build.ts econ: mode='build' while ante <= 2 or margin < 1; from ante 3 mode='save' with reserve = 5 * interestCap ($25). In shopCandidates, a purchase that leaves money < reserve needs jokerFit >= 0.8 (core) or marginAhead < 1; otherwise add penalty 0.1 per interest dollar lost.

### Take a money joker (Mail-In Rebate, Business Card, Credit Card, Reserved Parking, Golden Ticket) in antes 1–2 even over a small scoring gain.

`econ.money-jokers-first` · said and seen in his decision logs · confidence high · Roffle · when: antes 1–3, shop

Why: A money joker bought early pays every round of the run and funds the interest cap; he says Mail-In Rebate justifies itself on one good round.

- said, [e-xjK3zeAVM 1:17](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=77s), ante ~2: "Like that justifies the mail-in rebate, full stop on its own."
- said, [e-xjK3zeAVM 1:23](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=83s), ante ~2: "Like we could hit zero more rebate cards and it would still be phenomenal value off of it."
- said, [bb3UmQWsofM 6:17](https://www.youtube.com/watch?v=bb3UmQWsofM&t=377s), ante ~3: "Never ending money. I mean, like I guess that's what we you expect when you take a mail-in rebate, right?"
- said, [LXou4GPdMYY 4:49](https://www.youtube.com/watch?v=LXou4GPdMYY&t=289s), ante ~3: "If I didn't already have the business card, it probably would be the gold seal."
- did, [e-xjK3zeAVM 0:50](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=50s), ante ~1: buy_joker Mail-In Rebate (perishable) in ante 1 with $4
- did, [nLdGlAmcWAM 2:42](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=162s), ante ~2: pack_pick_joker Mail-In Rebate in ante 2
- did, [bb3UmQWsofM 0:32](https://www.youtube.com/watch?v=bb3UmQWsofM&t=32s), ante ~1: buy_joker Mail-In Rebate (eternal) in shop 1, ante 1, Hexed to Polychrome (Hex used at 30 s)
- did, [OTn6yl2jxGg 0:40](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=40s), ante ~1: Credit Card enters the row at 40 s in ante 1, Polychrome, right after the Hex use at 36 s (the log types it as a pack pick; he says he bought it in shop 1)

Code: jokerFit econ bonus at ante <= 2: +0.3 (keep as is) but raise ECON_INCOME.j_mail from 2 to 4 (Gold stake has 2 discards; he aims them at the rank) so incomePerRound and keep reflect it; at ante <= 2 an econ joker beats a flat joker whose gain < 0.25.

### Buy a Rental joker only for a job in the next round or two, sell it as soon as the job is done, and keep rentals long only when money is far above the cap.

`econ.rentals-are-short-hires` · said and seen in his decision logs · confidence high · Roffle and BalatroUniversity · when: stakes Gold, shop

Why: A rental costs $1 to buy and $3 a round, so a short hire is cheap while a kept rental eats the interest he plays for. He held many rentals only late, once he had over $100.

- did (decision logs): 18 Rental jokers taken across the 7 logged Gold runs; 13 sold or lost after a median of about 130 s (1–2 rounds), e.g. Misprint 18 s, Acrobat 20 s, Photograph 52 s, Chaos the Clown 66 s. The ones kept to the end were bought at ante 5–10 (Raised Fist, Oops! All 6s, Midas Mask, Sock and Buskin, The Idol).
- said, [yefo5lyt6wU 34:22](https://www.youtube.com/watch?v=yefo5lyt6wU&t=2062s), ante ~11: "So many rentals, I feel like I'm in an MTV Cribs video shoot."
- said, [SkwRy_N5D9A 6:01](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=361s), ante ~3-5: "Well, not on the spot. We'd bleed out money slowly."
- said, [BU qpCPl7Yo-pU 3:11](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=191s): "and as a rental, probably we just sell it, but at least we can use it in the next round."
- said, [BU qpCPl7Yo-pU 4:08](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=248s): "I think no matter what, I take Supernova as a rental, and then I guess you could sell it."

Code: stickerPenalty(rental): penalty = 0.05 * expectedRoundsHeld * rentalRate/3 (1 round for a job joker, 5 for a core piece) instead of a flat 0.15; drop to x0.3 when money - totalRent >= 25 + 15. Add a sell candidate for a rental whose keep < 0.3 (job done) at the next shop.

### Pass Eternal+Rental jokers unless the joker is a top copy or build-around you would keep all run anyway, and if you take one, start rebuilding the economy at once.

`econ.no-eternal-rentals` · said and seen in his decision logs · confidence high · Roffle and BalatroUniversity · when: stakes Gold, shop

Why: An Eternal Rental can never be sold, so it is $3 a round for the rest of the run, about the whole interest income at the cap.

- did (decision logs): Across the 5 original videos, 6 Eternal+Rental jokers were on offer in shops where he bought a joker; he took none. The one exception is Brainstorm (ante 2, brRkg1_VFAU 138 s).
- did, [brRkg1_VFAU 2:18](https://www.youtube.com/watch?v=brRkg1_VFAU&t=138s), ante ~2: buy_joker Brainstorm (eternal, rental) in ante 2 with ~$7
- said, [brRkg1_VFAU 2:12](https://www.youtube.com/watch?v=brRkg1_VFAU&t=132s), ante ~2: "Okay, well, now we're really going to need something to fix our econ because this is going to devastate it."
- said, [BU qpCPl7Yo-pU 7:19](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=439s): "Not taking golden lion [Golden Joker] as an eternal rental. If it wasn't a rental, I would take it."
- said, [nLdGlAmcWAM 15:30](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=930s), ante ~5: "Yeah, it wasn't so much the eternal rental."

Code: jokerFit: if eternal && rental, value -= 0.4 unless tags has 'copy' or rarity is LEGENDARY; when such a joker is owned, push 'econ' into needs regardless of ante.

### Count money in $5 steps and, before cash-out, sell spare items to reach the next breakpoint, holding total rent on top because rent is taken before interest is counted.

`econ.breakpoints-and-rent` · said and seen in his decision logs · confidence medium · Roffle and BalatroUniversity · when: stakes Gold, hand

Why: Interest is floor(money/5) at cash-out, and the game charges rentals at end of round first (state_events.lua:108 before the interest row at :1192). One spare consumable or a spent joker is often worth a whole $1 of interest every round.

- said, [yefo5lyt6wU 3:02](https://www.youtube.com/watch?v=yefo5lyt6wU&t=182s), ante ~2: "Did get to 18 which is important at least with the rental."
- said, [brRkg1_VFAU 6:03](https://www.youtube.com/watch?v=brRkg1_VFAU&t=363s), ante ~4: "I sold because I'm desperate for money right now. And it got me it's part of the reason that I got to the enter star shield [interest threshold]."
- said, [brRkg1_VFAU 6:36](https://www.youtube.com/watch?v=brRkg1_VFAU&t=396s), ante ~4: "I should have sold this on the chance that we drew the gold."
- did, [brRkg1_VFAU 5:12](https://www.youtube.com/watch?v=brRkg1_VFAU&t=312s), ante ~4: sell_joker Certificate (Negative, perishable) during a hand, money $7 -> $12
- said, [BU qpCPl7Yo-pU 15:01](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=901s): "Oh, maybe I should have sold it at the end there. We could have got more interest, maybe."
- said, [bb3UmQWsofM 4:48](https://www.youtube.com/watch?v=bb3UmQWsofM&t=288s), ante ~2: "I should have sold this. Minus $3, but we got a lot of money out of that round."

Code: interestOn(s, money) -> min(cap, floor((money - sum(j.rental)) / 5)). On the last hand of a round (or in the shop before leaving), if (5 - (money - rent) % 5) <= sell value of items with keep < 0.15 or consumables with value < 0.3, add a 'sell for interest' candidate with utility 0.45 + 0.05 * dollars of interest gained.

### Reroll the shop only out of money above the $25 interest floor plus rent, at any ante, and not at all while poor unless the run will die without a piece.

`econ.reroll-only-from-surplus` · said and seen in his decision logs · confidence medium · Roffle · when: shop

Why: A reroll paid out of the interest floor costs that interest every round after. In a poor run he waits; in a rich one he rerolls early, but always from surplus.

- did, [brRkg1_VFAU 9:24](https://www.youtube.com/watch?v=brRkg1_VFAU&t=564s), ante ~5: First reroll of a poor run ($1–8 through ante 3): ante 5 with $60 -> $52; all 11 logged rerolls at ante 5+
- did, [bb3UmQWsofM 5:36](https://www.youtube.com/watch?v=bb3UmQWsofM&t=336s), ante ~3: Rich run (Mail-In Rebate plus Hermits): rerolls at ante 2–3 only with $45–95 on hand, after buying Reroll Surplus (230 s); 22 rerolls logged
- said, [brRkg1_VFAU 2:49](https://www.youtube.com/watch?v=brRkg1_VFAU&t=169s), ante ~2: "I'm kind of hoping for a gold seal, though, because I'm so poor"
- said, [SkwRy_N5D9A 16:53](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=1013s), ante ~6: "Probably going to over roll a little bit here even with the seed money."
- said, [brRkg1_VFAU 23:30](https://www.youtube.com/watch?v=brRkg1_VFAU&t=1410s), ante ~9: "I can take one more roll here."
- said, [LXou4GPdMYY 44:37](https://www.youtube.com/watch?v=LXou4GPdMYY&t=2677s): "We shouldn't be using these. We should be selling them. One roll."

Code: candidates.ts reroll utility: allow 0.4 only while money - rerollCost - sum(rental) >= 25 (5 * interestCap) plus the cost of a planned buy, at any ante; otherwise cap it at 0.15 unless rerollCost == 0 or marginAhead < 1.

### Value a Perishable joker by what it does in the rounds you actually need it, and sell it when it is spent; a perishable Negative gives no lasting slot.

`econ.perishables-by-rounds-left` · said and seen in his decision logs · confidence medium · Roffle and BalatroUniversity · when: stakes Orange/Gold, shop

Why: A perishable is debuffed after 5 rounds, so only those rounds count. Its Negative slot dies with it.

- said, [yefo5lyt6wU 16:28](https://www.youtube.com/watch?v=yefo5lyt6wU&t=988s), ante ~7: "If the brainstorm didn't like allow me to win exactly into like if it didn't last exactly five rounds, which is how many we have remaining, I'd probably sell it."
- said, [e-xjK3zeAVM 4:32](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=272s), ante ~3: "I miss you, rebate. Thank you for saving this run."
- did, [e-xjK3zeAVM 4:36](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=276s), ante ~3: sell_joker Mail-In Rebate (perishable) at cash-out, about 4 rounds after buying it in ante 1
- did (decision logs): 26 Perishable jokers taken across the 7 logged runs; 24 sold or lost, after a median of about 175 s (2–3 rounds), mostly to make room once they had done their job.
- said, [BU qpCPl7Yo-pU 3:01](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=181s): "perishable negatives don't really matter because they're going to become debuffed before the extra joker slot matters."

Code: jokerFit: when perishable, the NEGATIVE edition bonus (+0.3) becomes +0.05; value = gain over min(perishable rounds, rounds until the needed blind). Offer a sell when perishable <= 1 or keep < 0.2.

### Keep valuing steady money sources after ante 8 when the run can keep going; prefer a lasting income over a one-off payout.

`econ.late-money-engines` · said only · confidence medium · Roffle · when: ante 8+

Why: In endless, each extra ante is bought with money (rerolls, packs, Spectrals). He takes the source of money that keeps paying.

- said, [nLdGlAmcWAM 22:52](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=1372s): "There's maybe an argument for taking the money now, but it's a lot of money over the course of the run if we're able to extend it any further."
- said, [bb3UmQWsofM 37:50](https://www.youtube.com/watch?v=bb3UmQWsofM&t=2270s), ante ~11: "So that we can get a bunch of money off of this golden ticket."
- said, [IK2QVkr5fzE 26:14](https://www.youtube.com/watch?v=IK2QVkr5fzE&t=1574s): "Money is probably most important right now. We find a rebate, we can rip that first."

Code: jokerFit econ bonus after ante 4: 0.15 instead of 0.05 when the run is past ante 8 or marginAhead >= 1.5 (endless pace); count ECON_INCOME over the expected remaining antes, not 1.

### With Credit Card, go into debt to buy scaling jokers early, and treat Wraith's money loss as free while you are in debt.

`econ.credit-card-debt` · said and seen in his decision logs · confidence low · Roffle · when: shop

Why: Credit Card lets money go to -$20, and Wraith sets money to $0, which is a gain when you are below zero.

- said, [OTn6yl2jxGg 5:06](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=306s), ante ~3: "We just need to hit another wraith and then we don't have to worry about money, right?"
- said, [OTn6yl2jxGg 5:31](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=331s), ante ~3: "This uh credit card is going kind of crazy."
- said, [OTn6yl2jxGg 13:12](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=792s), ante ~7: "Oh my god, we're out of debt. [laughter] It took seven anties, but we got there."
- did, [OTn6yl2jxGg 1:48](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=108s), ante ~1: buy_consumable Wraith (Negative) at -$5 in ante 1

Code: If owned j_credit_card and money < 0: c_wraith is not risky (drop from RISKY_SPECTRALS for this case) and its money effect is +|money|; allow spending down to -20 for jokers with jokerFit >= 0.7.

## Stake (difficulty)

### At Gold stake, buy cheap early scoring (Blue Joker, flat +Mult) in antes 1–2 that you would skip at White stake, where you should bank the money instead.

`stake.gold-buys-early-scoring` · said and seen in his decision logs · confidence medium · Roffle · when: stakes Gold/White, antes 1–2, shop

Why: Gold-stake blinds grow faster and leave no slack early, so a few cheap chips stop an early loss. At White stake the same money is better saved.

- said, [-GUBw5pfwWY 0:57](https://www.youtube.com/watch?v=-GUBw5pfwWY&t=57s), ante ~2: "I think we [snorts] can buy nothing. It is a white steak [stake]. We don't really need the chips that badly. If there were a gold steak [stake], I'd definitely be taking the uh blue man [Blue Joker] there."
- did (decision logs): Cheap early scorers bought at Gold in antes 1–2: Gros Michel (SkwRy 40 s, nLdGl 68 s, brRkg1 66 s), Jolly Joker (SkwRy 78 s), Zany Joker (nLdGl 38 s), Hanging Chad and Hiker (bb3 112 s, 236 s), Blue Joker (e-xjK 334 s, ante 3).
- said, [oqiWiv4ygWU 1:15](https://www.youtube.com/watch?v=oqiWiv4ygWU&t=75s), ante ~1-2: "But we do need some scoring soon."

Code: conditions(): add earlyScoring = {WHITE: -0.1, ..., GOLD: +0.12}; at ante <= 2 add it to jokerFit for jokers whose gain > 0.1 when margin < 2. Do not let the Gold 'skip marginal buys' note (knowledge.ts STAKE_NOTES.GOLD) suppress these.

### At Gold stake, lean on non-joker resources (Planets, Tarots, Spectrals, seals, enhancements) and play whatever the offers support instead of forcing a joker plan.

`stake.gold-work-with-what-you-get` · said only · confidence high · Roffle · when: stakes Gold

Why: Joker offers at Gold are often poor and sticker-laden; he says people overestimate jokers, and the runs that survive are carried by levels, Steel, Glass and Spectrals.

- said, [SkwRy_N5D9A 25:38](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=1538s): "When I say you've got to work with what you're given on gold stake, I I mean you've got to work with what you're given and sometimes this is all you're given."
- said, [SkwRy_N5D9A 26:08](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=1568s): "people overestimate the importance of jokers in this game. That's why I think that jokerless is a very good teaching tool in learning how to like leverage non-joker resources."
- said, [SkwRy_N5D9A 25:51](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=1551s): "This is not an uncommon build or situation to be in."

Code: At Gold, when the best joker offer has jokerFit < 0.5, raise consumableValue for Planets of the primary hand (+0.1) and enhancement/seal Tarots (+0.1), and raise Standard/Arcana/Celestial packValue by 0.05.

### Use the current stake rules (Black: Eternal, Orange: Perishable, Gold: Rental at $3 a round), not older guides that call Gold -1 hand size.

`stake.current-sticker-rules` · said only · confidence high · Roffle · when: stakes Black/Orange/Gold

Why: The stakes were reworked; old advice built around -1 hand size or Orange booster-pack costs no longer applies.

- said, [brRkg1_VFAU 22:48](https://www.youtube.com/watch?v=brRkg1_VFAU&t=1368s), ante ~9: "Old gold stake was minus one hand size."
- said, [brRkg1_VFAU 22:50](https://www.youtube.com/watch?v=brRkg1_VFAU&t=1370s), ante ~9: "It was uh orange stake that was the booster pack change."
- said, [oqiWiv4ygWU 45:14](https://www.youtube.com/watch?v=oqiWiv4ygWU&t=2714s): "You play blacks like you have eternal jug as [jokers] but not rental? Yeah, and I've done some black stake runs in the past."

Code: knowledge.ts STAKE_NOTES already matches the current rules; key the rental and perishable logic on stakeAtLeast(GOLD) and stakeAtLeast(ORANGE) (conditions().rentalRate and .perishable).

## Deck

### On Checkered, use the free flushes to clear antes 1–2, but don't commit to Flush unless flush payoff jokers arrive; find a chips joker and move to Pairs.

`deck.checkered-flushes-early-pairs-later` · said only · confidence medium · Roffle and BalatroUniversity · when: decks Checkered, antes 1–4

Why: Two-suit decks make flushes without help, so early scoring is free. Long term, flush payoff jokers rarely come, and four flushes a round cost too many hands.

- said, [BU qpCPl7Yo-pU 0:10](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=10s): "The checker deck gives you a huge head start in the direction of playing flushes, but you may not find the game pieces which actually reward you for playing flushes. It may make sense to do something else instead."
- said, [BU qpCPl7Yo-pU 45:29](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=2729s): "That doesn't mean you should play flushes."
- said, [BU qpCPl7Yo-pU 46:06](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=2766s): "so, once you find something like that, whether it's supernova or bus or green joker or red card, uh probably best to just play pairs."
- said, [yefo5lyt6wU 4:26](https://www.youtube.com/watch?v=yefo5lyt6wU&t=266s), ante ~3: "Finally a flush level. Two more. I think we just farm it out."
- said, [oqiWiv4ygWU 36:09](https://www.youtube.com/watch?v=oqiWiv4ygWU&t=2169s): "Four of a kind is better than a flush, so no reason to take that."

Code: DECKS.CHECKERED.favor.Flush = 2.5 only while ante <= 2; from ante 3 use 0.5 unless a flush- or suit-tagged joker is owned. Add Pair +0.5 once a chips or chip-scaling joker (Square, Hiker, Runner, Stone, Blue Joker) is owned.

### On Ghost Deck, plan around Spectrals: Hex the lone joker you bought in shop 1 (a money joker, twice) into Polychrome, Immolate for money and thinning, Ankh to double the build-around, and buy single Spectrals before opening a Spectral pack you want a specific card from.

`deck.ghost-spectral-plan` · said and seen in his decision logs · confidence medium · Roffle · when: decks Ghost

Why: Ghost Deck starts with Hex and sells Spectrals, so they replace part of the joker search. Cards you hold are not offered again, so holding Spectrals shrinks a pack's pool.

- said, [OTn6yl2jxGg 0:04](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=4s), ante ~1: "I hexed a shop one credit card on Ghost Deck because I thought it would be funny"
- said, [SkwRy_N5D9A 27:13](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=1633s): "Yeah, we're probably not going to get ectos and onk, so we might as well just go with the hex game plan."
- said, [SkwRy_N5D9A 31:26](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=1886s): "let's see if we can collect some um Spectrals first and then open the pack. Better chance at the Ankh."
- said, [bb3UmQWsofM 0:05](https://www.youtube.com/watch?v=bb3UmQWsofM&t=5s), ante ~1: "a flurry of early Emolates [Immolates] and Hermits followed by a trading card left me with a seven card deck"
- did (decision logs): Starting Hex used in antes 1–2 in all 5 Ghost runs with decision logs (bb3 30 s, e-xjK 32 s, OTn6y 36 s, nLdGl 66 s, SkwRy 180 s). In bb3 and OTn6y it went on the only joker held, a shop-1 money joker (Mail-In Rebate, Credit Card), which came out Polychrome. Ankh bought nLdGl 2048 s; Immolate bought OTn6y 366 s and bb3 242 s.

Code: DECKS.GHOST: in ante 1 buy one money or core joker and use the starting c_hex while it is the only joker (value 0.75); later c_hex 0.7 when one joker has jokerFit >= 0.6 and the others keep < 0.3; c_immolate value 0.6 (+$20, -5 cards) when the build is not Flush; before opening a Spectral pack, if a wanted Spectral is in the shop, buy it first.

### On Checkered, push the suit whose payoff joker you can get (Bloodstone for hearts), and switch suits if the resources point the other way.

`deck.checkered-suit-by-payoff` · said only · confidence medium · Roffle · when: decks Checkered

Why: Both suits are 26 cards, so the deck split says nothing; the payoff jokers decide.

- said, [oqiWiv4ygWU 12:07](https://www.youtube.com/watch?v=oqiWiv4ygWU&t=727s): "I would rather go hearts just so the bloodstone is available."
- said, [oqiWiv4ygWU 19:54](https://www.youtube.com/watch?v=oqiWiv4ygWU&t=1194s): "We haven't been given resources to go hearts."
- said, [oqiWiv4ygWU 19:06](https://www.youtube.com/watch?v=oqiWiv4ygWU&t=1146s): "It's like we may just be better off going speeds [spades]."

Code: build.ts themeSuit on CHECKERED: prefer the suit of an owned or offered suit joker (Bloodstone/Lusty/Arrowhead/Wrathful) over the larger share; re-evaluate when a suit Tarot pack shows only the other suit.

## Jokers

### Judge a joker by this run (hands per round, deck, other jokers), not by its tier; Loyalty Card with six hands a round is a real xMult.

`jokers.value-in-context` · said and seen in his decision logs · confidence high · Roffle · when: always

Why: A joker's effect depends on how often its condition fires in this run; he built a run on Loyalty Card because he had six hands.

- said, [SkwRy_N5D9A 8:18](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=498s), ante ~5: "Yeah, it's almost like the jokers depend or the value of the jokers depend on the context in which they are offered, but who would ever say such a thing like that?"
- said, [SkwRy_N5D9A 0:09](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=9s), ante ~1: "which included a loyalty card when I had six hands, and ensuring it would be active every round."
- did, [SkwRy_N5D9A 7:50](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=470s), ante ~3-5: buy_joker Loyalty Card (Holo), selling Jolly Joker

Code: knowledge.ts j_loyalty_card: tag 'xmult' only when handsPerRound >= 6 (fires every round); else model it as x4 every 6 hands (about x1.25 per hand) in estimateScore.

### When the next boss isn't safely beaten, take the scoring joker even if it doesn't fit the long-term plan.

`jokers.dont-greed-past-scoring` · said only · confidence high · Roffle · when: ante 3+, shop

Why: His worst deaths came from passing playable scoring to keep a greedy plan; he blames greed out loud in several runs.

- said, [nLdGlAmcWAM 0:09](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=9s), ante ~1: "led to biblical levels of greed, resulting in me passing on the few scoring jokers I was offered"
- said, [nLdGlAmcWAM 15:32](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=932s), ante ~5: "It was just that I was kind of overly committed in my mind to uh making this a high card run."
- said, [nLdGlAmcWAM 15:51](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=951s), ante ~5: "We do kind of need scoring, it turns out."
- said, [nLdGlAmcWAM 14:50](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=890s), ante ~5: "God, I could have packed so many photo chads into this build."
- said, [bb3UmQWsofM 45:15](https://www.youtube.com/watch?v=bb3UmQWsofM&t=2715s), ante ~13: "Oh, man. We lost so many runs to greed today."

Code: If marginAhead < 1.2, add +0.2 to jokerFit for any joker with gain > 0.15 on the current primary, even when support() == 0; plan.ts must not veto it as off-plan.

### Take a scaling or xMult build-around early even if it is Eternal, then stack the jokers it rewards.

`jokers.take-buildarounds-even-eternal` · said and seen in his decision logs · confidence high · Roffle · when: antes 1–7

Why: An Eternal is only a problem if you'd want to sell it, and you never want to sell a scaling xMult engine. Flat eternals are what he avoids.

- said, [e-xjK3zeAVM 1:32](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=92s), ante ~2: "Do we commit to the baseball card now? Sure, why not?"
- said, [e-xjK3zeAVM 0:05](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=5s), ante ~1: "the decision to take an eternal baseball card led me to stack as many uncommon jokers as I could find"
- said, [yefo5lyt6wU 28:58](https://www.youtube.com/watch?v=yefo5lyt6wU&t=1738s), ante ~10: "Like my options are don't take the lucky cat and therefore there is no late game to consider or take the lucky cat"
- did (decision logs): Every Eternal he took (7 logs) was a scaling, xMult, copy, retrigger or money piece: Constellation (Holo, ante 1), Mail-In Rebate (ante 1, then Hexed to Polychrome), Baseball Card (ante 2), Brainstorm (ante 2, also Rental), Photograph (ante 3), Joker Stencil (ante 5), Lucky Cat (ante 7), Glass Joker (ante 7), Hanging Chad (ante 13). No flat +Mult or +Chips eternal was taken.

Code: candidates.ts eternal penalty: 0 when tags intersect {xmult, scaling, copy, econ}; 0.25 (not 0.15) for flat +Mult/+Chips eternals. After taking a build-around, add its payoff tag (e.g. 'uncommon' for Baseball Card) to the plan's wanted tags.

### Buy Blueprint or Brainstorm only with a joker worth copying, and fix their position after every change to the row.

`jokers.copy-needs-a-target` · said and seen in his decision logs · confidence high · Roffle · when: always

Why: A copy joker is worth exactly its neighbour. He forgets to move it and loses score, and he says his double Brainstorm run struggled for lack of targets.

- said, [brRkg1_VFAU 15:09](https://www.youtube.com/watch?v=brRkg1_VFAU&t=909s), ante ~7: "And we just need to sell this into the brainstorm, but we need to find something that the brainstorm can do. That's not it."
- said, [brRkg1_VFAU 0:09](https://www.youtube.com/watch?v=brRkg1_VFAU&t=9s), ante ~1: "a lack of good options to copy meant that I was still struggling for score"
- said, [OTn6yl2jxGg 20:23](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=1223s): "Oh, I forgot to move the blueprint. It's a certified blueprint bad moment."
- said, [nLdGlAmcWAM 35:26](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=2126s): "Blueprint wrong spot. Yep. That's what's going on here."
- said, [SkwRy_N5D9A 30:40](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=1840s): "The reason Six Sense cannot be copied by Blueprint or Brainstorm is because of that first destroy it."
- did, [nLdGlAmcWAM 21:56](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=1316s): 46 reorder_jokers in this run; many move Blueprint between Raised Fist and Mail-In Rebate

Code: jokerFit copy bonus = 0.35 if the best copyable joker has contribution >= 0.2, else 0.12; after any buy/sell run bestOrder() and give 'rearrange' utility >= 0.6 when a copy joker's neighbour changed; mark j_sixth_sense, j_trading and other destroy effects as not copyable.

### By ante 4–5 at Gold, get a multiplicative source (xMult, Glass, Lucky Cat, Baseball Card stacks) before more additive jokers.

`jokers.need-multiplicative` · said only · confidence high · Roffle · when: stakes Gold, ante 4+

Why: Additive jokers stop keeping pace once blinds scale; he values stacks of x1.5 as exponents.

- said, [brRkg1_VFAU 7:50](https://www.youtube.com/watch?v=brRkg1_VFAU&t=470s), ante ~5: "Really just need something multiplicative."
- said, [yefo5lyt6wU 11:15](https://www.youtube.com/watch?v=yefo5lyt6wU&t=675s), ante ~5: "Yeah, a single malt [mult] hit is like a 1.5x Joker."
- said, [yefo5lyt6wU 33:47](https://www.youtube.com/watch?v=yefo5lyt6wU&t=2027s), ante ~11: "1.5 to the fifth, it's got to be better than 4.5, right? Yeah, it's 76."
- said, [OTn6yl2jxGg 24:15](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=1455s): "Cuz this modest scaling is not going to do the trick for much longer."

Code: build.ts needs: push 'xmult' at ante >= 4 on Gold whenever marginAhead < 1.5, even with one xMult owned; value Baseball Card as 1.5^(uncommons owned) in estimateScore.

### Pass a strong-looking joker that has no synergy with the build or that you don't need as a long-term scorer.

`jokers.pass-no-synergy` · said and seen in his decision logs · confidence medium · Roffle · when: shop

Why: A slot spent on an off-plan joker crowds out the payoff pieces; he passes Throwback and dumps a Negative Flash Card.

- said, [e-xjK3zeAVM 3:46](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=226s), ante ~2: "Should you take a throwback here? No. Throwback has no synergy or effectiveness with this build."
- said, [e-xjK3zeAVM 15:09](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=909s): "Yeah, negative flash card does look good. I just don't need it like as a scoring option in the long term, I don't think."
- did, [e-xjK3zeAVM 15:46](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=946s): sell_joker Flash Card (rental) to buy Invisible Joker

Code: jokerFit: when support() == 0 and the joker is not econ/copy and gain < 0.1, cap value at 0.4 once slots are 2 or fewer from full (Throwback in a no-skip run is worth ~0).

### Take decaying jokers (Turtle Bean, Gros Michel, Ice Cream, Popcorn, Seltzer) only when you need the score now.

`jokers.decaying-only-when-needed` · said and seen in his decision logs · confidence medium · Roffle · when: shop

Why: They shrink every round, so one bought for later is gone when you need it.

- said, [nLdGlAmcWAM 30:18](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=1818s): "But the thing about the bean is like and part of the reason we didn't take it is because by the time we need it, it's gone, right? Like we don't need the scoring now and then we lose it as an out when we do need the scoring."
- did (decision logs): Gros Michel bought in antes 1–2 in three runs when scoring was thin (SkwRy 40 s, nLdGl 68 s, brRkg1 66 s).

Code: Tag 'expires': value = gain_now * (margin < 1.5 ? 1 : 0.4) instead of the flat -0.05 keep adjustment.

### Treat a joker that bridges to a later build as temporary and don't overspend on packs or rerolls to feed it.

`jokers.bridge-without-overspending` · said only · confidence low · Roffle · when: shop

Why: Money spent growing a joker you'll sell is money lost to interest.

- said, [oqiWiv4ygWU 9:16](https://www.youtube.com/watch?v=oqiWiv4ygWU&t=556s): "Installation [Constellation]. I would have wanted to overspend on it with what we've got going on, but it's just a fine bridge into maybe a late game build."
- said, [oqiWiv4ygWU 9:38](https://www.youtube.com/watch?v=oqiWiv4ygWU&t=578s): "So, we're not going to like overspend on it."

Code: packValue(Celestial): the Constellation/Satellite +0.1 bonus applies only when that joker's keep >= 0.5 (core), not when the plan marks it as a bridge.

### Early, prefer a chips scaler such as Square Joker over Constellation, which matters only from late ante 3–4.

`jokers.square-over-early-constellation` · said only · confidence medium · BalatroUniversity · when: antes 1–3, pack

Why: Constellation needs many Planets to be worth a slot; Square gives the chips that let cheap hands score at once.

- said, [BU qpCPl7Yo-pU 4:48](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=288s): "Between the two of these, constellation probably not going to be super relevant until maybe the end of ante three, maybe partway through ante four."
- said, [BU qpCPl7Yo-pU 46:57](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=2817s): "I still take the square over the constellation there uh because of the ability of square joker to sort of just enable us to win the rest of the run"

Code: jokerFit at ante <= 3: Constellation's scaling bonus x0.5 unless 2+ Planets are held or a Celestial pack is affordable; Square Joker +0.1 when the build is Pair/Two Pair/High Card.

## Pivots

### Pivot to the hand or rank your resources support (Strength or Death into the rank that holds your seals), not the one you started with.

`pivots.follow-the-resources` · said only · confidence medium · Roffle · when: antes 2–8

Why: Seals, enhancements and levels you already own are the cheapest power; picking the rank where they sit multiplies them.

- said, [bb3UmQWsofM 5:35](https://www.youtube.com/watch?v=bb3UmQWsofM&t=335s), ante ~3: "We could get some strength, so we could turn out or move out of flushes and into like I don't know. Four of a kind."
- said, [bb3UmQWsofM 6:58](https://www.youtube.com/watch?v=bb3UmQWsofM&t=418s), ante ~3: "There's our strength. I think we want to go kings because that's where the purples are."
- said, [LXou4GPdMYY 10:00](https://www.youtube.com/watch?v=LXou4GPdMYY&t=600s), ante ~3-5: "really want to be doing diamonds here. Could be moving to four of a kind once we find a way out of that. Purple could also be a high card build."

Code: pivotOptions: add Four of a Kind when Strength or Death is held and one rank has >= 3 sealed or enhanced cards; set deckFix target rank = argmax(seals + enhancements) among ranks with >= 3 copies.

### Once a plan is clearly finished (enough levels, payoff joker gone, utility joker now hurting), stop feeding it and commit to one build.

`pivots.commit-dont-straddle` · said only · confidence medium · Roffle · when: always

Why: Straddling two builds splits Planets and slots so neither scores; he names the indecision as the problem.

- said, [LXou4GPdMYY 34:54](https://www.youtube.com/watch?v=LXou4GPdMYY&t=2094s): "Just kind of caught between a couple different builds right now."
- said, [LXou4GPdMYY 36:12](https://www.youtube.com/watch?v=LXou4GPdMYY&t=2172s): "Bro can't make up his mind. I'm going to try committing to the high card."
- said, [LXou4GPdMYY 38:53](https://www.youtube.com/watch?v=LXou4GPdMYY&t=2333s): "More Pluto levels. I mean, that's way too many already. We're just done with that plan."
- said, [oqiWiv4ygWU 28:38](https://www.youtube.com/watch?v=oqiWiv4ygWU&t=1718s): "Like I think it's reaching the point where it's actively bad for me."

Code: plan.ts: if two archetypes stay within 10% for 2+ shops, commit to the one with higher marginAhead and stop the other's Planet purchases (Planet value 0.1 for a non-primary hand).

### You can carry a speculative build-around (Mime with no Steel yet) for a few antes while bridging with another hand, but commit hard (Ankh, enhancements) as soon as its payoff shows up.

`pivots.carry-speculative-then-commit` · said only · confidence medium · Roffle · when: ante 3+

Why: The build-around is the run's ceiling, but only once fed; he lost a run by waiting too long to double the Mime.

- said, [LXou4GPdMYY 17:03](https://www.youtube.com/watch?v=LXou4GPdMYY&t=1023s), ante ~5: "Zero steel right now, though. This is super sketchy. If I take it, we'd probably have to play four of a kind. Maybe that's the play until we can get this set up."
- said, [LXou4GPdMYY 0:05](https://www.youtube.com/watch?v=LXou4GPdMYY&t=5s): "an early speculative mime eventually became the buildar around [build-around] Joker when I finally got steel cards online"
- said, [LXou4GPdMYY 46:40](https://www.youtube.com/watch?v=LXou4GPdMYY&t=2800s): "If I hadn't been a coward and actually pulled the trigger on the enk [Ankh] when I I had a couple opportunities"

Code: Allow buying a build-around with current contribution 0 when upside() >= 0.45 and a bridge archetype has margin >= 1.2; once its payoff cards exist (e.g. Steel count >= 2 for Mime), c_ankh value 0.8 targeting it.

## Deck fixing

### Thin the deck hard (Immolate, Hanged Man, Trading Card) when the build doesn't care about deck size, but stop before you can't draw the scoring hand.

`fix.thin-hard-but-not-too-far` · said and seen in his decision logs · confidence medium · Roffle · when: always

Why: A small deck shows the key cards every hand, but cutting too far breaks pairs and suits.

- said, [IK2QVkr5fzE 0:09](https://www.youtube.com/watch?v=IK2QVkr5fzE&t=9s): "copying enough emulates [Immolates] to get down to an 11 card deck."
- said, [SkwRy_N5D9A 10:09](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=609s), ante ~5: "I can't draw a pair anymore. I sincerely can't draw a pair to save I'm like I'm dead."
- said, [brRkg1_VFAU 26:36](https://www.youtube.com/watch?v=brRkg1_VFAU&t=1596s), ante ~10: "This is what I get for cutting too many spades, I guess."
- said, [bb3UmQWsofM 29:49](https://www.youtube.com/watch?v=bb3UmQWsofM&t=1789s), ante ~8: "Got to start adding cards. We're fine. We've got sufficient cards for now."
- did (decision logs): The Hanged Man used in 5 of 6 logged runs, as early as ante 1 (OTn6y 94 s) and ante 2 (SkwRy 180 s).

Code: deckFix: for Four of a Kind or held-card High Card builds aim for deckSize <= handSize + 4; stop destroy Tarots when the primary rank has < 4 copies (Four of a Kind) or < 2 pairs per hand size (Pair).

### Prefer Trading Card for thinning (it also pays); without it, use The Hanged Man on the rank you're cutting.

`fix.trading-card-thins` · said and seen in his decision logs · confidence medium · Roffle · when: always

Why: Trading Card destroys the first discard each round and pays $3, so it thins and earns at once.

- said, [yefo5lyt6wU 21:19](https://www.youtube.com/watch?v=yefo5lyt6wU&t=1279s), ante ~7-8: "So, just have to fix our deck the old-fashioned way by removing all of the sixes."
- said, [oqiWiv4ygWU 25:37](https://www.youtube.com/watch?v=oqiWiv4ygWU&t=1537s): "We just need to find a trading card so that we can actually make progress on our deck fixing, unlike whatever it is that the DNA does."
- did, [e-xjK3zeAVM 6:04](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=364s), ante ~3: buy_joker Trading Card (perishable, rental) in ante 3, sold about 2 min later

Code: jokerFit j_trading: +0.2 when deckFix.goal includes destroy (Pair/Four of a Kind/High Card) and deckSize > 30; tag it econ+deckfix (already).

### Use Death early to copy seal cards (purple, red, gold, blue) and the build's key cards.

`fix.death-on-seals-early` · said and seen in his decision logs · confidence medium · Roffle and BalatroUniversity · when: antes 1–6

Why: Each copy pays every round after, so the earlier the better.

- said, [oqiWiv4ygWU 13:32](https://www.youtube.com/watch?v=oqiWiv4ygWU&t=812s): "I think it's still early enough to death the purple."
- said, [bb3UmQWsofM 40:02](https://www.youtube.com/watch?v=bb3UmQWsofM&t=2402s), ante ~12: "Death into red seal and then fool it."
- said, [BU qpCPl7Yo-pU 27:54](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=1674s): "Probably the correct thing to do is use death on the blue seal."
- did, [e-xjK3zeAVM 6:34](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=394s), ante ~3: use_consumable Death around ante 3, right after buying it with The Tower

Code: c_death: value +0.15 when ante <= 6 and the right-hand target has a seal or Steel/Glass/Gold/Lucky; choose the target with a seal first.

### Skip deck-fixing pieces when the build already wins with any hand, and take the voucher instead.

`fix.skip-fixing-when-winning` · said only · confidence low · Roffle · when: shop

Why: Fixing buys consistency you don't need when every hand wins.

- said, [OTn6yl2jxGg 8:28](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=508s), ante ~5: "Where's Vagabond when you need him? I don't need him. We don't need deck fixing this run."
- said, [OTn6yl2jxGg 11:21](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=681s), ante ~5: "I do think I'd rather just have the voucher, though."

Code: When margin >= 3 on the primary hand, reduce destroy/convert Tarot value by 0.15 and raise voucher value by 0.05.

## Hands and levelling

### When scoring comes from jokers or held cards, pick one cheap hand (High Card or Pair) and pour every matching Planet into it.

`hands.spam-one-cheap-hand` · said and seen in his decision logs · confidence high · Roffle and BalatroUniversity · when: always

Why: Cheap hands are always drawable, so levels and hand-independent xMult (Hologram, Constellation, Steel with Baron or Mime) do the work.

- said, [nLdGlAmcWAM 1:32](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=92s), ante ~2: "Clearly pairs are too dangerous for me. I need to play high card. A gentleman's hand."
- said, [OTn6yl2jxGg 12:25](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=745s), ante ~7: "do have a level 26 high card though."
- said, [SkwRy_N5D9A 22:52](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=1372s), ante ~7: "I'm just going to keep spamming Mercury."
- said, [e-xjK3zeAVM 28:37](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=1717s): "Level 29 pair is not bad."
- said, [BU qpCPl7Yo-pU 46:32](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=2792s): "But, once you have some kind of chips joker, then it no longer matters what hand you play. Then you can start uh spamming the lower ranking hands."
- did, [OTn6yl2jxGg 12:58](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=778s), ante ~7: High Card was level 26 by 745 s; Pluto gains and uses logged repeatedly from 778 s (ante 7) on

Code: build.ts archetype base: High Card -1.5 -> 0 when held-card jokers (Baron, Mime, Raised Fist, Shoot the Moon) with Steel/Kings, or hand-independent xMult (Hologram, Constellation, Lucky Cat, Stencil, Loyalty Card), are owned; Celestial packValue +0.15 when the primary hand is level >= 5.

### When the last hand will win anyway, play non-winning hands first that grow scaling jokers or cash seals, then finish with the winner.

`hands.throwaway-hands-to-scale` · said only · confidence high · Roffle and BalatroUniversity · when: hand

Why: Hands you don't need to win are free scaling (Square Joker, Ride the Bus, Lucky Cat triggers, purple/blue seals).

- said, [BU qpCPl7Yo-pU 17:20](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=1040s): "Can I play a pair which doesn't win? I think the answer is yes so that we can square up."
- said, [SkwRy_N5D9A 21:26](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=1286s), ante ~7: "I guess we knew that wasn't going to win in the second hand, so I shouldn't have like I should have done a throwaway hand."
- said, [yefo5lyt6wU 3:29](https://www.youtube.com/watch?v=yefo5lyt6wU&t=209s), ante ~2: "What if we don't play the pair to try and get less score here?"
- said, [e-xjK3zeAVM 23:37](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=1417s): "I don't want this to win yet."

Code: SELECTING_HAND candidates: if best * (handsLeft - 1) >= remaining and a per-hand scaler (Square, Ride the Bus, Green Joker, Runner, Wee, Hiker, Lucky Cat with Lucky cards, Supernova) or a purple/blue seal can fire, add a 'scale first' play that leaves remaining > 0, utility above the winning play.

### Farm Blue Seals for Planet levels early; stop prioritising them once levels are high.

`hands.blue-seals-early` · said only · confidence medium · Roffle · when: antes 1–8

Why: A Blue Seal held at end of round makes the Planet of the last hand; the gain shrinks as levels pile up.

- said, [OTn6yl2jxGg 8:49](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=529s), ante ~5: "Just need to draw two blues every round."
- said, [OTn6yl2jxGg 9:48](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=588s), ante ~5: "maybe the blue is better"
- said, [brRkg1_VFAU 11:16](https://www.youtube.com/watch?v=brRkg1_VFAU&t=676s), ante ~6: "I think we have enough levels that I don't really care that much about the blue seal. So, we're getting pretty severe dimension [diminishing] returns from them right now."

Code: cardValue / Death targeting: Blue Seal +0.15 while primary level < 8, +0.03 after; keep a Blue Seal card in hand on the last hand.

### For Pairs, add any value card freely (Gold, Blue Seals, Stone, face cards); the deck's makeup hardly matters.

`hands.pairs-dont-care-about-the-deck` · said only · confidence medium · BalatroUniversity · when: pack

Why: Pairs show up in any deck, so every value card is pure gain.

- said, [BU qpCPl7Yo-pU 47:15](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=2835s): "very easy to add random garbage to your deck with let's say uh certificate, these random purple seals, diamonds and clubs."
- said, [BU qpCPl7Yo-pU 47:39](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=2859s): "that's the reason you play pairs is cuz you don't care what's in your deck. You don't care what's in your hand."

Code: cardValue when primary is Pair: +0.1 for any enhancement or seal regardless of suit; Certificate and Marble Joker +0.1.

## Skips and tags

### At Gold stake, play every small and big blind instead of skipping for tags.

`skips.play-every-blind-at-gold` · seen in his decision logs · confidence medium · Roffle and BalatroUniversity · when: stakes Gold, blind select

Why: A skipped blind gives up the shop and the round's cash-out: interest (up to $5), money-joker payouts, and a round of scaling. At Gold that is the economy the run is built on.

- did, [brRkg1_VFAU 0:08](https://www.youtube.com/watch?v=brRkg1_VFAU&t=8s), ante ~1: 39 select_blind events over 13 antes (small, big and boss every ante), zero skips
- did, [bb3UmQWsofM 0:06](https://www.youtube.com/watch?v=bb3UmQWsofM&t=6s), ante ~1: 39 select_blind events over 13 antes, zero skips; so 0 skips in 26 antes across the two runs whose logs record blinds
- counterpoint, said, [BU qpCPl7Yo-pU 10:13](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=613s): "I think no matter what I take the buffoon tag here."

Code: candidates.ts blind skip: remove the +0.08 small-blind bonus at Red+ (skipping still loses the round's interest); at Gold require ratio > 3 and TAG_VALUE >= 0.6 (Negative, Investment, Rare, Polychrome, Voucher, or Buffoon with open slots) before skip utility can beat 0.6.

## Bosses

### Before each boss, check whether the build beats it, and buy a specific answer in the shop before it (flat Mult, Glass, a hand it allows).

`bosses.buy-an-answer-before-the-boss` · said only · confidence medium · Roffle · when: shop

Why: Bosses end runs, not small blinds; general power doesn't fix a specific rule.

- said, [bb3UmQWsofM 3:44](https://www.youtube.com/watch?v=bb3UmQWsofM&t=224s), ante ~2: "We kind of need to find a solution for the boss line like any reasonable amount of flat molds [mult] would be good here. It's good, but doesn't solve the boss blind."
- said, [yefo5lyt6wU 11:33](https://www.youtube.com/watch?v=yefo5lyt6wU&t=693s), ante ~5: "Glass could be the answer into the boss."
- said, [LXou4GPdMYY 21:02](https://www.youtube.com/watch?v=LXou4GPdMYY&t=1262s), ante ~5-7: "Boss blind is going to be a problem if I don't find something before then"
- said, [brRkg1_VFAU 12:39](https://www.youtube.com/watch?v=brRkg1_VFAU&t=759s), ante ~6: "Okay, the flint kills me, so I need to beat this boss blind without dying."

Code: In the shop before a boss, compute bossMargin = power * hands / bossTarget under bossRule(); if < 1.2, add +0.2 to offers that raise the boss-hand score (flat Mult/Chips under The Flint, any xMult) and +0.1 to Glass/Justice.

### With Director's Cut, reroll The Needle and The Flint when the build is thin.

`bosses.reroll-needle-and-flint` · said only · confidence medium · Roffle · when: blind select

Why: One hand (Needle) or halved base (Flint) is where a thin build dies.

- said, [nLdGlAmcWAM 11:12](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=672s), ante ~5: "Oh god, the needle again. Uh, we might have to roll off of that."
- said, [nLdGlAmcWAM 16:48](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=1008s), ante ~5: "the way it's looking, Flint probably has to be a roll"
- said, [nLdGlAmcWAM 13:16](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=796s), ante ~5: "I have to just reroll it now. Probably gets me through."

Code: candidates.ts nastyBoss(): add The Flint (bossRule.halvesBase) when the primary hand's level is <= 3 or margin < 2.5; The Needle is already covered by the 'only 1 hand' rule.

### Against Verdant Leaf, take the last value from an expiring joker, then sell it to lift the debuff.

`bosses.verdant-leaf-sell-spent` · said and seen in his decision logs · confidence medium · Roffle · when: hand

Why: The sale is forced anyway; make it the joker that is about to die.

- said, [yefo5lyt6wU 22:29](https://www.youtube.com/watch?v=yefo5lyt6wU&t=1349s), ante ~7-8: "Boss blind is Britain Leaf [Verdant Leaf]. We can still get six hands [Sixth Sense] value and then sell it out of it."
- did, [yefo5lyt6wU 23:02](https://www.youtube.com/watch?v=yefo5lyt6wU&t=1382s), ante ~8: Sixth Sense (perishable) leaves the row during the Verdant Leaf round (logged as lose_joker; README notes a Verdant Leaf sale logged as a loss)

Code: candidates.ts sellToLift: choose the joker with the lowest (perishable rounds left, keep), not just the weakest; use its effect first when it triggers on the first hand.

### Buy Matador only when the next boss's ability will actually trigger on your hands, and make sure you trigger it.

`bosses.matador-only-if-it-triggers` · said only · confidence medium · Roffle · when: shop

Why: Matador pays $8 when the boss ability fires; a boss that can't fire on your deck pays nothing.

- said, [yefo5lyt6wU 0:51](https://www.youtube.com/watch?v=yefo5lyt6wU&t=51s), ante ~1: "I don't have clubs in my deck otherwise this would be a very good matador."
- said, [LXou4GPdMYY 6:26](https://www.youtube.com/watch?v=LXou4GPdMYY&t=386s), ante ~3: "And really want this matador into the boss blind."
- said, [LXou4GPdMYY 7:31](https://www.youtube.com/watch?v=LXou4GPdMYY&t=451s), ante ~3: "Thank you, Matador. I didn't even play that very well and it still was quite good."

Code: jokerFit j_matador: value 0.6 when the upcoming boss's rule will trigger on the deck (suit debuffs need that suit present; The Psychic needs 5-card plays etc.), else 0.2.

### In a face-card build, keep a few non-face scoring cards (e.g. Glass aces) as insurance against The Plant.

`bosses.plant-insurance` · said only · confidence low · Roffle · when: always

Why: The Plant debuffs every face card, which zeroes a face build for a round.

- said, [bb3UmQWsofM 16:04](https://www.youtube.com/watch?v=bb3UmQWsofM&t=964s), ante ~5: "Make uh, some aces with glass on them, too. Case of bad boss one, just take the glass cards in case of uh, the plant."

Code: When theme == 'face', Glass/Steel Tarot targets prefer one or two non-face cards; bossRule: add The Plant (debuffs face) to nastyBoss when theme == 'face'.

## Shop and vouchers

### Buy the run-long vouchers (Overstock, Seed Money, Director's Cut) when affordable early; save for Seed Money when it is in reach.

`shop.vouchers-early` · said only · confidence medium · Roffle and BalatroUniversity · when: antes 1–4, shop

Why: A voucher pays every remaining round, so it's worth more the earlier it is bought.

- said, [IK2QVkr5fzE 19:56](https://www.youtube.com/watch?v=IK2QVkr5fzE&t=1196s): "Voucher's important."
- said, [e-xjK3zeAVM 2:21](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=141s), ante ~2: "Probably want that voucher but don't need it yet."
- said, [yefo5lyt6wU 5:05](https://www.youtube.com/watch?v=yefo5lyt6wU&t=305s), ante ~3: "All right, probably want the voucher here."
- said, [nLdGlAmcWAM 27:25](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=1645s): "Overstock would be wonderful."
- said, [BU qpCPl7Yo-pU 5:26](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=326s): "I think I go overstock right away."
- said, [BU qpCPl7Yo-pU 11:06](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=666s): "I want to save my money for seed money, I think."

Code: VOUCHER_VALUE at ante <= 3: v_overstock_norm 0.52 -> 0.62, v_directors_cut 0.4 -> 0.5 at Gold; keep the Seed Money/Money Tree early bonus.

### When a purchase depends on what a pack might hold, open the pack first and decide after.

`shop.open-packs-before-deciding` · said only · confidence low · Roffle and BalatroUniversity · when: shop

Why: The pack can make the purchase pointless or necessary.

- said, [BU qpCPl7Yo-pU 4:37](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=277s): "the decision whether or not to buy misprint depends on this buffoon pack. So, let's go buffoon pack first."
- said, [oqiWiv4ygWU 0:24](https://www.youtube.com/watch?v=oqiWiv4ygWU&t=24s), ante ~1: "Probably not buying the voucher, so let's check the buffoon pack."

Code: shopCandidates ordering: when both a pack and a joker/voucher are affordable but not both, rank the pack first if its value is within 0.1 of the item.

## Packs

### On Checkered (or any deck that already scores), skip Buffoon packs in the first shops; on decks without early scoring, open them.

`packs.checkered-no-early-buffoon` · said only · confidence medium · Roffle and BalatroUniversity · when: stakes Black/Orange/Gold, decks Checkered, antes 1–2, shop

Why: At high stakes Buffoon packs often hold rentals, perishables or unwanted eternals; the $4–6 lost also loses interest that compounds. Roffle on Ghost opens them in ante 1 because that deck has no free scoring.

- said, [BU qpCPl7Yo-pU 2:21](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=141s): "So, what I suggest every time on the checker deck, don't open the buffoon packs. You don't need them. And there's a good chance that the buffoon packs actually just fail on the higher stakes with a perishables and rentals and stuff like that."
- said, [BU qpCPl7Yo-pU 48:14](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=2894s): "then uh you lose that money immediately and then also you lose a compounding amount of money over the next couple rounds because of compounding interest."
- counterpoint, did (decision logs): Roffle (Ghost and Checkered decks) took jokers from packs in ante 1 in 5 of 6 logged runs (Buffoon where the pack name was read: OTn6y 70 s, SkwRy 40 s, e-xjK 28 s, nLdGl 38 s; brRkg1 48 s took two jokers from one pack).

Code: packValue(Buffoon): 0.3 when deck is CHECKERED and ante <= 2 or margin >= 2 from deck alone; at Black+ subtract 0.06 for sticker risk; keep 0.52 on decks without early scoring.

## Consumables

### Hold The Hermit until money is near $20, then use it.

`consumables.hermit-at-20` · said and seen in his decision logs · confidence medium · Roffle and BalatroUniversity · when: shop

Why: Hermit doubles money up to +$20, so using it at $6 wastes most of it.

- said, [BU qpCPl7Yo-pU 2:51](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=171s): "And then we'll just keep the hermit so that we can maximize the value."
- said, [BU qpCPl7Yo-pU 4:04](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=244s): "now we got 19 bucks, so Hermie here makes sense."
- did, [SkwRy_N5D9A 24:06](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=1446s), ante ~7: Hermit used at about $19 (HUD $19 -> $48 around cash-out; logged as a sell)
- said, [yefo5lyt6wU 7:45](https://www.youtube.com/watch?v=yefo5lyt6wU&t=465s), ante ~5: "more hermit value to try and find more scoring."

Code: candidates.ts c_hermit: use utility = 0.3 + min(20, money)/30 only when money >= 15 or the consumable slot is needed; otherwise hold (utility 0.1).

### Use Ankh on the build-around joker as soon as the run depends on it.

`consumables.ankh-the-key-joker` · said and seen in his decision logs · confidence medium · Roffle · when: decks Ghost, ante 5+

Why: Two copies of the joker that scores beat every other row, and he names waiting on Ankh as why one run died.

- said, [LXou4GPdMYY 46:40](https://www.youtube.com/watch?v=LXou4GPdMYY&t=2800s): "If I hadn't been a coward and actually pulled the trigger on the enk [Ankh] when I I had a couple opportunities"
- said, [LXou4GPdMYY 47:42](https://www.youtube.com/watch?v=LXou4GPdMYY&t=2862s): "But probably needed to like greed the enk [Ankh] a little bit more or something."
- said, [SkwRy_N5D9A 34:14](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=2054s): "With an Ankh, we get through this next ante, probably. Without one, we do not."
- did, [nLdGlAmcWAM 34:08](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=2048s): buy_consumable Ankh (Negative) at ante 10

Code: c_ankh: value 0.8 (and not blocked by RISKY_SPECTRALS) when one joker has contribution >= 0.5 and the jokers it destroys have keep < 0.3 combined.

### Sell spare consumables for money (a reroll, a breakpoint) rather than using low-value ones.

`consumables.sell-spares-for-money` · said only · confidence low · Roffle · when: shop

Why: A $1–3 sale can be a reroll or $1 of interest every round; a weak Tarot used blindly is worth less.

- said, [LXou4GPdMYY 44:37](https://www.youtube.com/watch?v=LXou4GPdMYY&t=2677s): "We shouldn't be using these. We should be selling them. One roll."
- said, [IK2QVkr5fzE 27:58](https://www.youtube.com/watch?v=IK2QVkr5fzE&t=1678s): "There's no point in clicking these. Selling it is faster."

Code: useCandidates: when a consumable's value < 0.3, offer 'sell' at value 0.3 + 0.05 * interest dollars gained (see econ.breakpoints-and-rent).

## Endless and naneinf

### For runs aimed far past ante 15, pick Plasma Deck; other decks top out much earlier.

`endless.plasma-deck` · said only · confidence low · Roffle · when: decks Plasma, ante 9+

Why: Plasma averages chips and mult, which lets scores keep pace in deep endless.

- said, [oqiWiv4ygWU 29:47](https://www.youtube.com/watch?v=oqiWiv4ygWU&t=1787s): "No, we'll maybe be lucky if we make it to anti-15 right now. We're not on plasma deck. Even if we were on plasma deck, this would not make it to anti-27."
- said, [SkwRy_N5D9A 3:32](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=212s), ante ~3: "only one that is in the conversation unless you're really good at getting perky ears [Perkeo]."

Code: When the run goal is a high-ante endless, autoStart deck = PLASMA; DECKS.PLASMA already sets balanced.

### For naneinf, build the money engine first, then thin the deck to about 11 cards, then stack Steel and red seals for Baron and Mime, and copy the pieces with Perkeo, Cryptid and copy jokers.

`endless.naneinf-order` · said only · confidence medium · Roffle · when: stakes White, decks Ghost

Why: Every later piece (rerolls for Baron, Mime, copies) is bought with money, and a tiny deck lets the red-seal Steel kings be drawn every hand.

- said, [-GUBw5pfwWY 0:07](https://www.youtube.com/watch?v=-GUBw5pfwWY&t=7s), ante ~1: "This run got off to a fast start thanks to a natural negative business card from a judgment and an early baron."
- said, [IK2QVkr5fzE 0:09](https://www.youtube.com/watch?v=IK2QVkr5fzE&t=9s): "copying enough emulates [Immolates] to get down to an 11 card deck. The extra money made it easy to find the required jokers except for a baron"
- said, [-GUBw5pfwWY 15:40](https://www.youtube.com/watch?v=-GUBw5pfwWY&t=940s), ante ~7: "so that we can brute force our money engine."
- said, [IK2QVkr5fzE 10:46](https://www.youtube.com/watch?v=IK2QVkr5fzE&t=646s): "Now the problem is I don't really have any scoring. Now I have steel."
- said, [IK2QVkr5fzE 8:52](https://www.youtube.com/watch?v=IK2QVkr5fzE&t=532s): "Early temperance is good."

Code: Endless/naneinf mode: phase A (antes 1–4) jokers tagged econ +0.3 and Temperance/Immolate +0.2; phase B deckSize target <= 15 with Steel on kings; phase C value Baron, Mime, Blueprint, Brainstorm, Invisible at 1.0; Cryptid targets the red-seal Steel king.

### In the late game, spend on whatever is limiting the run (money, a missing joker, copies), not on something you already have enough of.

`endless.buy-the-bottleneck` · said only · confidence medium · Roffle · when: ante 8+

Why: Extra copies of a piece that isn't the bottleneck add nothing.

- said, [IK2QVkr5fzE 24:54](https://www.youtube.com/watch?v=IK2QVkr5fzE&t=1494s): "Like we don't need to accelerate the cryptids that much. Because we're like we're three rounds away from just having enough already. So, there's no cryptids aren't the limiting factor."
- said, [IK2QVkr5fzE 25:26](https://www.youtube.com/watch?v=IK2QVkr5fzE&t=1526s): "So, rebate is really what we're looking for right now."
- said, [-GUBw5pfwWY 24:35](https://www.youtube.com/watch?v=-GUBw5pfwWY&t=1475s): "Actually, it wasn't even the mime that was limiting the copy jokers."

Code: In endless, compute the shortfall per need (money for rerolls, missing core joker, copies) and add +0.2 to offers that fill the largest shortfall; offers that add to an already-met need get value x0.5.

### Past ante 8 at Gold, expect builds without exponential scaling to die around ante 10–13, so double the main xMult (Ankh, copies) and stop adding flat pieces.

`endless.gold-post-ante-8` · said and seen in his decision logs · confidence medium · Roffle · when: stakes Gold, ante 9+

Why: All nine Gold runs here won ante 8 and died in endless at ante 10–13, usually to modest scaling.

- said, [e-xjK3zeAVM 26:20](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=1580s): "we just don't beat anti [ante] 12 with this type of build, right? You can see the limitations of a vampire."
- said, [OTn6yl2jxGg 24:08](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=1448s): "Where's my brainstorm? Cuz this modest scaling is not going to do the trick for much longer."
- said, [OTn6yl2jxGg 25:44](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=1544s): "Probably a little late for the obelisk."
- did (decision logs): End points read from the HUD: ante 10, 11, 11, 12, 12, 12, 12, 12, 13 across the nine Gold videos.

Code: Past ante 8: falloff() for flat jokers -> 0.25 immediately; jokerFit copy bonus 0.5 when a copy target has contribution >= 0.4; c_ankh as in consumables.ankh-the-key-joker.

## Joker notes

| Joker | Note | Evidence |
| - | - | - |
| Mail-In Rebate (`j_mail`) | Best early money joker in his play: 'justifies itself' on one round, gives 'never ending money', and was the naneinf target. He bought it at ante 1 even as a perishable and sold it once spent. | "Like that justifies the mail-in rebate, full stop on its own." ([e-xjK3zeAVM 1:17](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=77s))<br>"So, rebate is really what we're looking for right now." ([IK2QVkr5fzE 25:26](https://www.youtube.com/watch?v=IK2QVkr5fzE&t=1526s))<br>did: buy_joker Mail-In Rebate (perishable), ante 1 ([e-xjK3zeAVM 0:50](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=50s)) |
| Credit Card (`j_credit_card`) | Enables a debt economy; he Hexed a shop-1 Credit Card to Polychrome and spent seven antes in debt feeding scaling jokers. | "This uh credit card is going kind of crazy." ([OTn6yl2jxGg 5:31](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=331s))<br>did: pack_pick_joker Credit Card, ante 1 ([OTn6yl2jxGg 0:40](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=40s)) |
| Business Card (`j_business`) | Early money that 'did its job' setting up a naneinf run even when it stopped scoring; he'd take it over a Gold Seal card. | "Like the business card isn't doing much now, but like it did its job in getting this set up" ([-GUBw5pfwWY 11:34](https://www.youtube.com/watch?v=-GUBw5pfwWY&t=694s))<br>"If I didn't already have the business card, it probably would be the gold seal." ([LXou4GPdMYY 4:49](https://www.youtube.com/watch?v=LXou4GPdMYY&t=289s)) |
| Matador (`j_matador`) | Only good when the boss ability will fire on your deck. | "I don't have clubs in my deck otherwise this would be a very good matador." ([yefo5lyt6wU 0:51](https://www.youtube.com/watch?v=yefo5lyt6wU&t=51s))<br>"And really want this matador into the boss blind." ([LXou4GPdMYY 6:26](https://www.youtube.com/watch?v=LXou4GPdMYY&t=386s)) |
| Golden Ticket (`j_ticket`) | Golden Ticket is a money engine with Gold cards; he played towards Dusk to farm it. | "So that we can get a bunch of money off of this golden ticket." ([bb3UmQWsofM 37:50](https://www.youtube.com/watch?v=bb3UmQWsofM&t=2270s)) |
| Reserved Parking (`j_reserved_parking`) | Money engine for naneinf; worth more than Showman there. | "Yeah, parkin [Reserved Parking] would go instead of showman for sure." ([-GUBw5pfwWY 8:51](https://www.youtube.com/watch?v=-GUBw5pfwWY&t=531s)) |
| Bull (`j_bull`) | Needs you to hold money; BalatroUniversity passes it when planning to spend. | "So, the the problem with the bull is you have to keep the money in order for the bull to be big. I think I'd rather just spend the money and do something more interesting." ([BU qpCPl7Yo-pU 20:38](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=1238s)) |
| Baseball Card (`j_baseball`) | Build-around: taken as an Eternal in ante 2, then every Uncommon becomes x1.5; value it as 1.5^(uncommons). | "Do we commit to the baseball card now? Sure, why not?" ([e-xjK3zeAVM 1:32](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=92s))<br>"1.5 to the fifth, it's got to be better than 4.5, right? Yeah, it's 76." ([yefo5lyt6wU 33:47](https://www.youtube.com/watch?v=yefo5lyt6wU&t=2027s))<br>did: pack_pick_joker Baseball Card (eternal), ante 2 ([e-xjK3zeAVM 1:38](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=98s)) |
| Constellation (`j_constellation`) | Taken early when Planets flow (Holo Eternal in ante 1; Astronomer feeds it), but BalatroUniversity rates it irrelevant before late ante 3–4, and once it's only a bridge he won't overspend on it. | "Honestly, like the astronomer is kind of a kind of a big deal here for getting these constellations going." ([e-xjK3zeAVM 27:37](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=1657s))<br>"Between the two of these, constellation probably not going to be super relevant until maybe the end of ante three, maybe partway through ante four." ([BU qpCPl7Yo-pU 4:48](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=288s))<br>did: pack_pick_joker Constellation (Holo, eternal), ante 1 ([OTn6yl2jxGg 1:10](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=70s)) |
| Hologram (`j_hologram`) | Pairs with Constellation and any card-adding effect; easy to slot into Pairs. | "Are we just going full hologram constellation mode? That could be fun." ([OTn6yl2jxGg 4:27](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=267s))<br>"Of course, if we are playing pairs, then things like hologram become very easy to slot in." ([BU qpCPl7Yo-pU 47:09](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=2829s)) |
| Blueprint (`j_blueprint`) | Only as good as its neighbour; he forgets to move it and calls it out each time. | "Oh, I forgot to move the blueprint. It's a certified blueprint bad moment." ([OTn6yl2jxGg 20:23](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=1223s))<br>"Blueprint wrong spot." ([nLdGlAmcWAM 35:26](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=2126s)) |
| Brainstorm (`j_brainstorm`) | Worth an Eternal Rental in ante 2 to him, but useless without a target. A perishable one is kept only for the rounds it covers. | "we need to find something that the brainstorm can do. That's not it." ([brRkg1_VFAU 15:12](https://www.youtube.com/watch?v=brRkg1_VFAU&t=912s))<br>"I'm going to be honest, I was looking for an excuse to get out of that brainstorm" ([yefo5lyt6wU 18:05](https://www.youtube.com/watch?v=yefo5lyt6wU&t=1085s))<br>did: buy_joker Brainstorm (eternal, rental), ante 2 ([brRkg1_VFAU 2:18](https://www.youtube.com/watch?v=brRkg1_VFAU&t=138s)) |
| Lucky Cat (`j_lucky_cat`) | Late scaling xMult he takes even as Eternal; strong with Oops! All 6s and retriggers. | "I think I have a long history of underestimating just how much the dice does for the cat." ([yefo5lyt6wU 23:41](https://www.youtube.com/watch?v=yefo5lyt6wU&t=1421s))<br>did: buy_joker Lucky Cat (eternal), ante 7 ([yefo5lyt6wU 15:08](https://www.youtube.com/watch?v=yefo5lyt6wU&t=908s)) |
| Oops! All 6s (`j_oops`) | Doubles Lucky card odds; he says he long underrated it for Lucky Cat. | "I think I have a long history of underestimating just how much the dice [Oops! All 6s] does for the cat. Cuz it does a lot." ([yefo5lyt6wU 23:41](https://www.youtube.com/watch?v=yefo5lyt6wU&t=1421s))<br>did: buy_joker Oops! All 6s (rental), ante 7 ([yefo5lyt6wU 18:32](https://www.youtube.com/watch?v=yefo5lyt6wU&t=1112s)) |
| Square Joker (`j_square`) | BalatroUniversity's early pick over Constellation for Pairs; it wants 4-card hands, which pushes for a smaller deck. | "I think I value the square very highly." ([BU qpCPl7Yo-pU 5:05](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=305s))<br>"The problem is because of this uh square boy, we see less of our deck. We just need to make a smaller deck." ([nLdGlAmcWAM 3:01](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=181s)) |
| Loyalty Card (`j_loyalty_card`) | Real xMult when hands per round is a multiple of 6 (six hands means active every round). | "Loyalty card being good, what has the world come to?" ([SkwRy_N5D9A 8:16](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=496s))<br>did: buy_joker Loyalty Card (Holo) ([SkwRy_N5D9A 7:50](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=470s)) |
| Joker Stencil (`j_stencil`) | Taken as an Eternal around the Loyalty Card; a second Stencil was his out against Vessel. | "I mean, if we get a second stencil, we'll be fine." ([SkwRy_N5D9A 23:18](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=1398s))<br>did: buy_joker Joker Stencil (eternal), selling three jokers ([SkwRy_N5D9A 12:02](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=722s)) |
| Baron (`j_baron`) | naneinf centrepiece with Steel kings and Mime; passed at Gold when it would just drain money. | "skipping the Baron is a better play." ([SkwRy_N5D9A 6:07](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=367s))<br>"It doesn't help me. I need Baron." ([IK2QVkr5fzE 23:11](https://www.youtube.com/watch?v=IK2QVkr5fzE&t=1391s)) |
| Mime (`j_mime`) | Speculative build-around: carried for antes with no Steel; the last naneinf piece. He wanted Ankh on it sooner. | "it could be time just to take ank [Ankh] on a mime if we really want to fully commit to this." ([LXou4GPdMYY 37:27](https://www.youtube.com/watch?v=LXou4GPdMYY&t=2247s))<br>"Mine [Mime] is pretty far from the top of my list of things that I want here." ([IK2QVkr5fzE 15:49](https://www.youtube.com/watch?v=IK2QVkr5fzE&t=949s)) |
| Riff-Raff (`j_riff_raff`) | Good, and can spawn Negatives, but it can miss for several rounds; he sold it after it delivered. | "Riffraff [Riff-Raff] is good, but as we saw yesterday it can miss for several consecutive rounds." ([oqiWiv4ygWU 2:38](https://www.youtube.com/watch?v=oqiWiv4ygWU&t=158s))<br>"And we kind of got what we need off of the riffraff [Riff-Raff]." ([oqiWiv4ygWU 6:48](https://www.youtube.com/watch?v=oqiWiv4ygWU&t=408s)) |
| DNA (`j_dna`) | Utility for deck building; he dropped it once it started costing score. | "Probably we're just done with the DNA now." ([oqiWiv4ygWU 26:06](https://www.youtube.com/watch?v=oqiWiv4ygWU&t=1566s)) |
| Trading Card (`j_trading`) | His preferred thinning joker; keep it over Ancient Joker when the deck needs cutting. | "We just need to find a trading card so that we can actually make progress on our deck fixing" ([oqiWiv4ygWU 25:37](https://www.youtube.com/watch?v=oqiWiv4ygWU&t=1537s))<br>"And trading card is good here." ([bb3UmQWsofM 25:07](https://www.youtube.com/watch?v=bb3UmQWsofM&t=1507s)) |
| Sixth Sense (`j_sixth_sense`) | Not copyable by Blueprint or Brainstorm (it destroys a card); a High Card play that isn't a single 6 breaks it. | "The reason Six Sense cannot be copied by Blueprint or Brainstorm is because of that first destroy it." ([SkwRy_N5D9A 30:40](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=1840s))<br>"Well, no, I can't play a high card because the Six Sense then is no longer active." ([SkwRy_N5D9A 30:18](https://www.youtube.com/watch?v=SkwRy_N5D9A&t=1818s)) |
| Turtle Bean (`j_turtle_bean`) | Decays; not worth it before you need the hand size. | "by the time we need it, it's gone, right?" ([nLdGlAmcWAM 30:23](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=1823s)) |
| Vampire (`j_vampire`) | Caps out: he says this kind of build doesn't beat ante 12, and a second Vampire is bad. | "You can see the limitations of a vampire." ([e-xjK3zeAVM 26:34](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=1594s))<br>"unfortunately, the second vampire is quite bad." ([e-xjK3zeAVM 18:50](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=1130s)) |
| Space Joker (`j_space`) | Carried early levels in two runs, but stopped mattering once levels were high. | "The spaceman is cracked, but we don't really need him until that much anymore." ([brRkg1_VFAU 10:26](https://www.youtube.com/watch?v=brRkg1_VFAU&t=626s))<br>"The spaceman is incredible." ([bb3UmQWsofM 44:04](https://www.youtube.com/watch?v=bb3UmQWsofM&t=2644s)) |
| Glass Joker (`j_glass`) | A run-saver when Glass cards come (Justice); he regretted not chasing Glass harder. | "You know, I'm beginning to realize I did not chase the glass hard enough here." ([yefo5lyt6wU 14:23](https://www.youtube.com/watch?v=yefo5lyt6wU&t=863s))<br>did: buy_joker Glass Joker (eternal), ante 7 ([brRkg1_VFAU 15:44](https://www.youtube.com/watch?v=brRkg1_VFAU&t=944s)) |
| Throwback (`j_throwback`) | No value without skips; he passes it. | "Throwback has no synergy or effectiveness with this build." ([e-xjK3zeAVM 3:48](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=228s)) |
| Flash Card (`j_flash`) | Looks good, even Negative, but isn't a long-term scorer. | "Yeah, negative flash card does look good. I just don't need it like as a scoring option in the long term" ([e-xjK3zeAVM 15:09](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=909s)) |
| Hallucination (`j_hallucination`) | Strong Tarot generator in his runs ('too good' to sell). | "This hallucination is playing out of its mind right now." ([nLdGlAmcWAM 8:44](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=524s))<br>"I think this hallucination is still just too good." ([brRkg1_VFAU 35:36](https://www.youtube.com/watch?v=brRkg1_VFAU&t=2136s)) |
| Supernova (`j_supernova`) | BalatroUniversity takes it as a rental and sells; Flush/Supernova builds rarely justify the hands they cost. | "I think no matter what, I take Supernova as a rental, and then I guess you could sell it." ([BU qpCPl7Yo-pU 4:08](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=248s)) |
| Sock and Buskin (`j_sock_and_buskin`) | Preferred over Dusk: always-on retriggers beat last-hand-only ones. | "Would I like to re-trigger five cards or sometimes five cards?" ([yefo5lyt6wU 27:23](https://www.youtube.com/watch?v=yefo5lyt6wU&t=1643s)) |
| Card Sharp (`j_card_sharp`) | Perishable Card Sharp carried a late run; when it expired, the run was expected to die. | "But like when the card sharp dies, we probably die" ([e-xjK3zeAVM 26:15](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=1575s)) |
| Invisible Joker (`j_invisible`) | Not worth a slot just to speed up copies when copies aren't the bottleneck. | "there are better spots for us to make it faster to find the uh the Baron than an invisible." ([IK2QVkr5fzE 24:45](https://www.youtube.com/watch?v=IK2QVkr5fzE&t=1485s)) |
| Fortune Teller (`j_fortune_teller`) | Sell it once it stops contributing. | "I should have sold the fortune teller a long time ago." ([-GUBw5pfwWY 21:16](https://www.youtube.com/watch?v=-GUBw5pfwWY&t=1276s)) |
| Bloodstone (`j_bloodstone`) | The Hearts payoff that decides the suit on Checkered, and the late xMult he hunts. | "I would rather go hearts just so the bloodstone is available." ([oqiWiv4ygWU 12:07](https://www.youtube.com/watch?v=oqiWiv4ygWU&t=727s))<br>"Yeah, I think it's just got to be a bloodstone." ([brRkg1_VFAU 38:23](https://www.youtube.com/watch?v=brRkg1_VFAU&t=2303s)) |
| Obelisk (`j_obelisk`) | Too late to grow once past mid-game. | "Probably a little late for the obelisk." ([OTn6yl2jxGg 25:44](https://www.youtube.com/watch?v=OTn6yl2jxGg&t=1544s)) |
| Photograph (`j_photograph`) | With Hanging Chad, the scoring he passed in his 'greed' run and regretted. | "God, I could have packed so many photo chads into this build." ([nLdGlAmcWAM 14:50](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=890s)) |
| Gros Michel (`j_gros_michel`) | Cheap early Mult he buys in antes 1–2 when scoring is thin, accepting that it may break. | "Oh, hey, it's a banana. Surely this one won't break frame one again." ([nLdGlAmcWAM 0:59](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=59s))<br>did: buy_joker Gros Michel, ante 1, selling Zany Joker ([nLdGlAmcWAM 1:08](https://www.youtube.com/watch?v=nLdGlAmcWAM&t=68s)) |
| Blue Joker (`j_blue_joker`) | Cheap early chips he'd take at Gold stake but not at White. | "If there were a gold steak [stake], I'd definitely be taking the uh blue man [Blue Joker] there." ([-GUBw5pfwWY 1:02](https://www.youtube.com/watch?v=-GUBw5pfwWY&t=62s)) |
| Astronomer (`j_astronomer`) | Makes Planets and Celestial packs free, which matters most with Constellation. | "Honestly, like the astronomer is kind of a kind of a big deal here for getting these constellations going." ([e-xjK3zeAVM 27:37](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=1657s)) |
| The Idol (`j_idol`) | Shares the Mail-In Rebate idea (a chosen rank each round) in a thin deck. | "Rebate and Idol have the same idea here." ([bb3UmQWsofM 24:37](https://www.youtube.com/watch?v=bb3UmQWsofM&t=1477s)) |
| Marble Joker (`j_marble`) | Adds Stone cards; fine filler for Pairs (stones don't hurt the hand). | "This is going to allow me to take a marble joker as well." ([e-xjK3zeAVM 2:47](https://www.youtube.com/watch?v=e-xjK3zeAVM&t=167s))<br>"spam the deck with rocks if you want with marble joker." ([BU qpCPl7Yo-pU 47:34](https://www.youtube.com/watch?v=qpCPl7Yo-pU&t=2854s)) |

## What he does vs what he only says

Seen in the decision logs (7 runs: 5 in `decisions.jsonl`, plus `brRkg1_VFAU.decisions.jsonl` and `bb3UmQWsofM.decisions.jsonl`, the only two that record blind selects and rerolls):

- Money on leaving the shop: antes 1–2 median $21, split between poor starts (47% of exits under $10) and starts where early money jokers paid. From ante 3 he holds the cap: antes 3–4 median $38 (71% at $25+), antes 5–8 $40 (79%), ante 9+ $54.5 (93%).
- Rentals: 18 taken, 13 sold or lost after a median of about 130 s. He took no Eternal+Rental joker except a Brainstorm.
- Eternals: only scaling, xMult, copy, retrigger or money pieces.
- Perishables: 26 taken, 24 released after a median of about 175 s.
- Skips: none in 26 antes across the two runs that log blinds.
- Rerolls: only out of surplus. None before ante 5 in the poor run; at antes 2–3 in the rich one, always with $45–95 on hand.
- Ghost Deck: the starting Hex is used in antes 1–2 in all 5 logged Ghost runs. Twice it went on a lone shop-1 money joker, which came out Polychrome.
- Early picks: cheap +Mult (Gros Michel, Jolly, Zany, Hanging Chad), money jokers (Mail-In Rebate three times, Credit Card, Business Card), and build-arounds whenever offered.

Said only (no log covers it):

- Rent-before-interest math, selling to reach a breakpoint, and White vs Gold early buying.
- Greed as the cause of deaths, commit-don't-straddle, and Ankh-the-key-joker.
- Plasma Deck for deep endless.
- Bosses: rerolling The Needle and The Flint, and Plant insurance.
- Hands: throwaway hands to scale.

## Gaps

- In these 11 caption tracks he never says outright that "economy matters more at higher stakes". His stake comments are about rentals and rent-vs-interest, Gold needing early scoring that White doesn't, the old Gold rule (-1 hand size), and "work with what you're given on gold stake". The economy-at-high-stakes argument is stated by BalatroUniversity (compounding interest; Buffoon packs failing to stickers). Roffle shows it in his money habits rather than saying it.
- Only White and Gold stakes appear, and only Ghost and Checkered decks. Nothing here covers the other 13 decks or the middle stakes.
- No endless run past the 13th ante, and no ante 30+ material. The naneinf runs are speedruns with a seed-filter mod (Perkeo in ante 1), so their early game is not natural.
- Only two runs' logs record blind skips, rerolls and hands played. The older five miss skips, tags, vouchers and hand choices, and money/ante OCR is noisy (ante 4 is often read as 5).
- 4 of the 11 videos (LXou4GPdMYY, oqiWiv4ygWU, -GUBw5pfwWY, IK2QVkr5fzE) have captions but no decision log yet, so their ideas are "says" only.
- He talks little (about 1,000–1,900 caption words per 30–50 minute video) and reads chat aloud, so many choices go unexplained.
