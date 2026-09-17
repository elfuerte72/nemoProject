#!/bin/bash
# usage: one.sh repo number base created
repo=$1; n=$2; base=$3; created=$4
ic=$(gh api "repos/elfuerte72/$repo/issues/$n/comments?per_page=100" --paginate 2>/dev/null)
rv=$(gh api "repos/elfuerte72/$repo/pulls/$n/reviews?per_page=100" --paginate 2>/dev/null)
pc=$(gh api "repos/elfuerte72/$repo/pulls/$n/comments?per_page=100" --paginate 2>/dev/null)
cr_status=$(echo "$ic" | jq -r '[.[] | select(.user.login=="coderabbitai[bot]") | .body |
  if test("Review skipped") then "skipped"
  elif test("Review limit reached|rate limit") then "limit"
  elif test("Walkthrough") then "walkthrough"
  else "other" end] | unique | join("+")' 2>/dev/null)
cr_plan=$(echo "$ic" | jq -r '[.[] | select(.user.login=="coderabbitai[bot]") | .body | capture("\\*\\*Plan\\*\\*: (?<p>[A-Za-z ]+)").p] | unique | join("+")' 2>/dev/null)
cr_reviews=$(echo "$rv" | jq '[.[] | select(.user.login=="coderabbitai[bot]")] | length' 2>/dev/null)
cr_inline=$(echo "$pc" | jq '[.[] | select(.user.login=="coderabbitai[bot]")] | length' 2>/dev/null)
gr_all=$(echo "$ic $rv $pc" | jq -s '[.[][] | select(.user.login|test("greptile";"i"))] | length' 2>/dev/null)
gr_inline=$(echo "$pc" | jq '[.[] | select(.user.login|test("greptile";"i"))] | length' 2>/dev/null)
bots=$(echo "$ic $rv $pc" | jq -rs '[.[][] | .user.login | select(test("\\[bot\\]"))] | unique | join(",")' 2>/dev/null)
printf "%s\t%s\t%s\t%s\tcr=%s\tplan=%s\tcr_reviews=%s\tcr_inline=%s\tgr_items=%s\tgr_inline=%s\tbots=%s\n" "$repo" "$n" "$base" "$created" "$cr_status" "$cr_plan" "$cr_reviews" "$cr_inline" "$gr_all" "$gr_inline" "$bots"
