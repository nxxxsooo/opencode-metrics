import { describe, expect, test } from "bun:test"
import { createSessionTree } from "../src/session-tree"

describe("createSessionTree", () => {
  test("returns only the current session in current scope", () => {
    // Given: a main session with known nested sub-agent sessions.
    const tree = createSessionTree()
    tree.setParent("ses_main", null)
    tree.setParent("ses_child", "ses_main")
    tree.setParent("ses_grandchild", "ses_child")

    // When: the current scope is requested.
    const ids = tree.getScopeSessionIDs("ses_main", "current")

    // Then: no child metrics can bleed into the default view.
    expect(ids).toEqual(["ses_main"])
    expect(tree.getChildSessionCount("ses_main")).toBe(2)
  })

  test("returns recursive descendants in tree scope", () => {
    // Given: two direct children and one nested child.
    const tree = createSessionTree()
    tree.setParent("ses_main", null)
    tree.setParent("ses_child_a", "ses_main")
    tree.setParent("ses_child_b", "ses_main")
    tree.setParent("ses_grandchild", "ses_child_a")

    // When: tree scope is requested.
    const ids = tree.getScopeSessionIDs("ses_main", "tree")

    // Then: the aggregate scope is the known session tree, rooted at current.
    expect(ids).toEqual(["ses_main", "ses_child_a", "ses_grandchild", "ses_child_b"])
    expect(tree.getChildSessionCount("ses_main")).toBe(3)
  })

  test("does not invent children when parent links are missing", () => {
    // Given: sessions exist but no parent link ties them to the current session.
    const tree = createSessionTree()
    tree.setParent("ses_main", null)
    tree.setParent("ses_unlinked_child", null)

    // When: tree scope is requested for the main session.
    const ids = tree.getScopeSessionIDs("ses_main", "tree")

    // Then: tree mode stays honest and only includes verifiably linked sessions.
    expect(ids).toEqual(["ses_main"])
    expect(tree.getChildSessionCount("ses_main")).toBe(0)
  })
})
