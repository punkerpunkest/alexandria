# Alexandria

An open source learning space for students, built on top of the model you already pay for.

Most students learn with LLMs now, but that experience has not really improved since the
first chatbot. Every gain has come from the model layer, and that has made answers more
correct without making them better to learn from. I think there are two problems with
learning this way. The interface was built for having a conversation rather than for
learning anything, and the dead time after every prompt makes it very easy to lose focus
and wander off. Alexandria is what I built to fix both of those.

It is a harness rather than a model. It wraps whatever you are already logged into and it
brings no inference of its own, so there is nothing to pay for on top of what you already
have.

## Worlds

The first thing Alexandria does is change the form an explanation arrives in. Worlds, as I
call them, take an ordinary reply and restage it. The same answer can come back as a lesson
from a Duolingo style tutor, or as a visual novel where one character confidently gets it
wrong in the way most people do before the other one corrects her, or as a long scrolling
article that plots its own diagrams as it goes.

Worlds ship no code at all, only templates and assets, so it is easy for a community to
build them around their own taste and safe for a student to install one. That works because
a world is a form and not a program. The model writes the words and picks from options the
world already ships, which means it cannot invent a layout or name a picture that does not
exist.

Three worlds ship in this repo: `cartoon`, `longform` and `visual-novel`.

## No dead time

The second thing is that the waiting is covered, and the trick is ordering. You say what you
want next before the interactive rather than after it, so the next lesson is already being
written underneath you while you work through the current one. The only real wait left is
the first answer of a session.

I went into this with the constraint that it should never be worse than just using the chat
normally. The wait was already there, so none of this costs extra time, only tokens, and
skipping an interactive just means you wait exactly as long as you would have anyway.

Those interactives can be quiz widgets like a multiple choice question or a flashcard, and
those ship with the app so a boundary can never come up empty. They can also be
community made simulations, like building a molecule up from atoms or learning to drive a
microscope, and those run sandboxed.

## Install

You need [Claude Code](https://claude.com/claude-code) installed and logged in, and Node 20
or newer. There is no API key, because Alexandria spends the subscription you already have.

```bash
git clone https://github.com/punkerpunkest/alexandria.git
cd alexandria
npm install
```

Then run it one of two ways.

```bash
npm run app     # the desktop app
npm start       # the same thing in a browser, on http://localhost:4173
```

Both run the identical server, projector, worlds and chrome. The app just owns its own
window.

## Using it

Type what you want to learn and press go. You get a module staged by whichever world is
active, you read it, and at the end you say what you want next. That ask is a required step
rather than a prompt you can ignore, because it is what gives the interactive something real
to cover.

Switch worlds from the symbol in the top left, which opens settings. `WORLD=<id>` picks the
default world at startup if you would rather set it there.

To install simulations from the registry, point the app at the index when you start it.

```bash
REGISTRY=https://alexandria-registry.vercel.app/index.json npm run app
```

## The registry

Community worlds and simulations live at
**[alexandria-registry.vercel.app](https://alexandria-registry.vercel.app)**.

Worlds are browsed and chosen by the student, because nobody wants a system picking their
aesthetic for them. Simulations are matched by the system the way an agent finds a skill.
Neither ships with Alexandria.

## The honest weakness

Installing community simulations means running content nobody here wrote, which is one leg
of the lethal trifecta and the part I am still working on. The other two legs are closed.
The model runs with no tools and no MCP, so there is nothing private for it to reach, and
the sandbox has no egress at all. That last one is measured rather than argued: there is an
engine in `engines/hostile-probe` whose only job is to attempt each escape and report what
happened.

## Licence

TBD.
