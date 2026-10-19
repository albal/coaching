# DevOps Career Coach

A coaching tool that helps DevOps engineers close the gap between their experience and a specific role they want. It's free and brings in leads for paid 1:1 coaching.

## Language

### Inputs

**Resume**:
The candidate's CV as text, given once per Session.
_Avoid_: CV, profile

**Job Description**:
The text of one job advert the candidate is targeting.
_Avoid_: JD (in user-facing text), posting, vacancy

### Work

**Session**:
One visitor's time on the site, from first upload until their data is deleted. It holds one Resume and up to three Analyses.
_Avoid_: visit, account

**Analysis**:
One Resume compared against one Job Description. Each Analysis produces one Report.
_Avoid_: scan, assessment, run

**Report**:
The coaching output for one Analysis: Fit Band, Gaps, plan, resume rewrites and interview prep. It's the only thing the user can take away.
_Avoid_: results, output

**Coaching Chat**:
A follow-up conversation about one Analysis, with its Resume, Job Description and Report in context.
_Avoid_: chatbot, assistant

### Judgements

**Fit Band**:
An overall verdict on how well the Resume matches the Job Description. It's never shown as a number.
- **Strong fit**: every must-have requirement has evidence; any Gaps are in nice-to-haves only.
- **Stretch**: one or two must-have Gaps, each realistically closable in about three months.
- **Long shot**: anything worse than Stretch.
_Avoid_: fit score, match percentage

**Must-have**:
A requirement the Job Description presents as essential, as opposed to a nice-to-have.
_Avoid_: hard requirement, mandatory skill

**Gap**:
A requirement in the Job Description that the Resume shows only partial or no evidence for.
_Avoid_: weakness, missing skill
